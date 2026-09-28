"""Этаж 10 «Трон демона» — карта (v2.81, второй заход).

Мотив — замок демонов: чёрный камень, красные ковры, золото, цепи,
витражи, колонны, жаровни, молнии в окнах, пропасть под мостами, шипы,
кости героев у ворот. Самый торжественный этаж — финал захода.

Три района снизу вверх:
  f10         — «Врата преисподней»: зал лифта с псарней, Врата с шипами,
                пропасть и мост с поворотом (зал-событие: мост рушится за
                спиной, из-за пропасти скачут рыцари ада), Двор казней
                (палач, виселицы, шахта, оссуарий за треснувшей стеной),
                Предмостье со стражей, служебный ход с решёткой к лифту.
  f10gallery  — «Галерея витражей»: притвор, длинная галерея с провалом и
                крестовым мостом (суккубы над пропастью), развилка:
                Витражный зал (зал-событие: гроза бьёт по клеткам) или
                Часовня свечей (маги, руна), реликварий за треснувшей
                стеной, Апсида, служебный ход с решёткой.
  f10throne   — «Тронный зал»: Зал присяги (колоннада, стража), старый
                подъёмник, Сокровищница (зал-ловушка: горгульи оживают,
                когда откроешь сундук), шахта под троном, Путь процессий к
                воротам, Тронный зал-арена, печать и Лестница в бездну.

Запуск: python3 scripts/dungeon/f10.py [--show] — пишет
src/lib/dungeon-floors/f10-map.ts (руками не править). Зерно постоянное.

Свои буквы (легенда — `AreaSpec.legend` в f10.ts):
  r  красный ковёр            m  чёрный мрамор с золотой жилой
  k  кости на полу            x  кровь                  z  копоть
  q  трещины в плитах         h  мост над пропастью     _  пропасть
  ^  шипы (ходят в ритме)     s  солома псарни          g  битое стекло
  d  помост трона             j  руна на полу           4  пол Витражного зала
  6  пол Сокровищницы         1  пост стража            3  пост палача
  2  постамент живой горгульи e  решётка над жаром
  w  витраж (стена)           n  знамя (стена)          J  цепи на стене
  H  резная арка Врат         Q  стена из черепов       t  бра с огнём
  F  кровавый фонтан в стене  f  чаша фонтана
  i  жаровня    y  канделябр   O  колонна    U  урна (бьётся)
  V  окованный ларь (бьётся)  Z  груда черепов (алтарь)
  W  статуя-горгулья           A  статуя дьявола   N  статуя владыки
  I  железная статуя           &  статуя латника   8  кровавый фонтан
  7  алтарь пламени            p  череп на пике    +  кости героев
  *  клетка на цепи            0  столб псарни (пёс на цепи)
  u  трон (под K)
"""
import os
import sys
from collections import deque

sys.path.insert(0, os.path.dirname(__file__))
from brush import Map, W, check, show, write_floor  # noqa: E402

FLOORISH = '.,rmkxzqh^sgdj461235e+'


def faces(m, x0, y0, x1, y1, ok='.,rmkxzqsgdj46e'):
    """Клетки стены, под которыми пол: лицо стены видно."""
    out = []
    for y in range(max(0, y0), min(m.h - 1, y1 + 1)):
        for x in range(max(1, x0), min(W - 1, x1 + 1)):
            if m.g[y][x] == '#' and m.g[y + 1][x] in ok and not m.lock[y][x]:
                out.append((x, y))
    return out


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


def hole(m, x, y):
    """Нора в кладке: стена, рядом пол любого вида (мрамор, ковёр…)."""
    def ok(x, y):
        return (m.get(x, y) == '#' and not m.lock[y][x] and 0 < x < W - 1 and any(
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
    raise AssertionError(('no burrow spot', x, y))


def put_face(m, x, y, c):
    """Настенное (витраж, знамя, цепи, бра): стена, под ней пол."""
    assert m.g[y][x] == '#', ('not wall', x, y, c, m.g[y][x])
    assert m.g[y + 1][x] in FLOORISH, ('no floor below', x, y, c, m.g[y + 1][x])
    m.put(x, y, c)


def rough_chasm(m, x0, y0, x1, y1, seed_k=0.0):
    """Пропасть с рваными краями: по каждой строке край гуляет на клетку."""
    import math
    for y in range(y0, y1 + 1):
        a = int(round(math.sin(y * 0.7 + seed_k) * 0.9 + math.sin(y * 0.31 + 1.7 + seed_k) * 0.6))
        b = int(round(math.sin(y * 0.53 + 2.1 + seed_k) * 0.9 + math.sin(y * 0.23 + seed_k) * 0.6))
        for x in range(x0 + max(0, a), x1 - max(0, b) + 1):
            if m.inb(x, y) and not m.lock[y][x]:
                m.g[y][x] = '_'


# ---------------------------------------------------------------------------
# Район 1 — «Врата преисподней» (вход, лифт).
# ---------------------------------------------------------------------------

def area_gates():
    H = 104
    m = Map(H, seed=10_001, cave=',')

    # --- Выход наверх, в Галерею: столбцы 30…33.
    m.rect(30, 0, 33, 15)

    # --- Предмостье: ряды 16…32.
    m.rect(8, 16, 55, 32)
    # Колонны.
    for x in (14, 22, 41, 49):
        for y in (20, 28):
            m.put(x, y, 'O')
    # Жаровни у выхода и у спусков.
    for (x, y) in ((27, 17), (36, 17), (9, 31), (54, 31)):
        m.put(x, y, 'i')
    # Посты стражи у выхода на север.
    m.put(28, 19, '1')
    m.put(35, 19, '1')
    # Ковёр от моста к выходу: по центру зала и на север.
    paint(m, 30, 17, 33, 31, 'r')
    paint(m, 30, 0, 33, 16, 'r')
    paint(m, 34, 29, 44, 31, 'r')
    # Кости героев, не дошедших до Галереи.
    for (x, y) in ((11, 18), (52, 18), (18, 30)):
        m.put(x, y, '+')
    speckle(m, 8, 16, 55, 32, 'k', 6)
    speckle(m, 8, 16, 55, 32, 'x', 5)
    m.put(12, 26, 'U')
    m.put(51, 25, 'U')
    m.put(46, 17, 'V')
    m.put(16, 23, 'R')          # спящая стая псов
    m.put(38, 23, '8')          # кровавый фонтан посреди Предмостья

    # --- Мост над пропастью. Пропасть — восток, x 25…54, ряды 33…73.
    rough_chasm(m, 25, 34, 54, 72)
    m.rect(25, 33, 54, 33, '_')
    m.rect(25, 73, 54, 73, '_')
    # Сегмент B: с Предмостья на юг (x 42…44, ряды 33…49).
    m.rect(42, 33, 44, 49, 'h')
    # Поворот: ряды 50…52, x 30…44.
    m.rect(30, 50, 44, 52, 'h')
    # Сегмент A: на юг к Вратам (x 30…32, ряды 53…73).
    m.rect(30, 53, 32, 73, 'h')
    # Предмостье выходит на мост ковром.
    m.rect(42, 32, 44, 32, 'r')
    # Кости на мосту — героев сбрасывали отсюда.
    for (x, y) in ((31, 60), (43, 41), (36, 51)):
        m.g[y][x] = 'k'

    # --- Площадка у Врат: ряды 74…76, x 26…36 (голова моста).
    m.rect(26, 74, 36, 76)
    for (x, y) in ((28, 76), (34, 76), (26, 75), (36, 75)):
        m.put(x, y, 'e')
    for (x, y) in ((27, 74), (35, 74)):
        m.put(x, y, 'p')

    # --- Врата: толща стены 77…87, проход x 30…33 с шипами.
    m.rect(30, 77, 33, 88)
    for y in (79, 81, 83, 85):
        for x in range(30, 34):
            m.put(x, y, '^')
    paint(m, 30, 77, 33, 88, 'r')

    # --- Двор казней: x 3…22, ряды 35…72 (запад, на твёрдой земле).
    m.rect(3, 36, 22, 72, ',', natural=True)
    m.rect(10, 33, 12, 35)             # к Предмостью
    m.rect(10, 73, 12, 89)             # к залу лифта
    m.rect(12, 88, 14, 90)
    # Виселицы-клетки, пики, плаха.
    for (x, y) in ((5, 40), (19, 40), (5, 52), (19, 58), (6, 66)):
        m.put(x, y, '*')
    for (x, y) in ((8, 45), (16, 45), (8, 60), (15, 64)):
        m.put(x, y, 'p')
    m.put(12, 52, '3')                 # пост палача — середина двора
    m.put(12, 50, 'Z')                 # плаха: груда черепов
    paint(m, 9, 49, 15, 55, 'x', 0.35, ok=',')
    for (x, y) in ((4, 70), (21, 70), (4, 37), (21, 37)):
        m.put(x, y, 'U')
    m.put(20, 47, 'V')
    m.put(13, 69, 'R')                 # спящая стая
    m.put(7, 57, 'a')                  # засада: со свода
    speckle(m, 3, 36, 22, 72, 'k', 8, ok=',')
    speckle(m, 3, 36, 22, 72, 'z', 5, ok=',')
    # Шахта — на северной стене двора (стена y 35, пол y 36).
    m.wall_obj(17, 35, 'M')
    m.put(18, 38, 'T')
    # Оссуарий за треснувшей стеной: x 3…6, ряды 61…65, вход с x 7.
    m.rect(3, 61, 6, 65, '.')
    for y in range(60, 67):
        m.set(7, y, '#')
    for x in range(2, 8):
        m.set(x, 60, '#')
        m.set(x, 66, '#')
    m.protect(2, 59, 8, 67)
    m.put(7, 63, '%')
    m.put(4, 63, '$')
    m.put(3, 61, '+')
    for x in (3, 4, 5, 6):
        m.put(x, 60, 'Q')
    m.put(6, 65, 'k')
    m.put(3, 65, 'k')

    # --- Зал лифта: x 14…49, ряды 89…100.
    m.rect(14, 89, 49, 100)
    paint(m, 30, 88, 33, 93, 'r')
    m.floor(31, 95, 'E')
    # Статуи дьяволов у Врат, арка, жаровни.
    m.put(26, 90, 'A')
    m.put(37, 90, 'A')
    for (x, y) in ((16, 90), (47, 90), (16, 99), (47, 99)):
        m.put(x, y, 'i')
    # Кости героев у ворот — тех, кто не прошёл.
    for (x, y) in ((22, 91), (41, 91), (28, 92), (35, 92)):
        m.put(x, y, '+')
    for (x, y) in ((24, 90), (39, 90)):
        m.put(x, y, 'p')
    speckle(m, 14, 89, 49, 100, 'x', 4)
    m.put(40, 97, 'T')
    m.put(19, 97, 'U')
    m.put(44, 97, 'U')
    # --- Псарня: запад, x 3…11, ряды 90…99; вход x 12…13, ряды 94…96.
    m.rect(3, 90, 11, 99)
    m.rect(12, 94, 13, 96)
    paint(m, 3, 90, 11, 99, 's', 0.8)
    m.put(6, 92, '0')
    m.put(6, 97, '0')
    m.put(10, 91, 'V')
    m.put(3, 99, 'U')
    m.put(4, 90, 'k')

    # --- Служебный ход: с Предмостья (x 55) вниз вдоль восточной стены к
    # залу лифта; решётка открывается только изнутри хода — с востока.
    m.rect(56, 22, 57, 24)
    m.rect(58, 22, 60, 97)
    m.rect(51, 96, 57, 98)
    m.put(50, 97, 'D')
    m.put(50, 96, '#')
    m.put(50, 98, '#')
    speckle(m, 58, 30, 60, 90, 'k', 4)
    m.put(59, 60, 'U')

    # --- Настенное. Врата: резные арки по лицу стены зала лифта.
    for x in range(22, 30):
        if m.g[88][x] == '#' and m.g[89][x] in FLOORISH:
            m.put(x, 88, 'H')
    for x in range(34, 42):
        if m.g[88][x] == '#' and m.g[89][x] in FLOORISH:
            m.put(x, 88, 'H')
    m.wall_obj(20, 88, 'b')
    # Знамёна на северной стене Предмостья, бра в зале лифта и во дворе.
    for x in (12, 18, 24, 39, 45, 51):
        put_face(m, x, 15, 'n')
    for x in (17, 44):
        put_face(m, x, 88, 't')
    for (x, y) in ((6, 35), (21, 35)):
        if m.g[y][x] == '#' and m.g[y + 1][x] in FLOORISH:
            m.put(x, y, 't')
    # Цепи на стенах псарни и двора.
    for (x, y) in ((9, 35), (13, 35)):
        put_face(m, x, y, 'J')
    for (x, y) in ((5, 89), (9, 89)):
        put_face(m, x, y, 'J')
    # Норы — дыры в кладке, откуда лезут.
    for (x, y) in ((8, 20), (55, 27), (2, 47), (23, 44), (23, 64), (2, 70), (61, 40)):
        hole(m, x, y)
    return m


# ---------------------------------------------------------------------------
# Район 2 — «Галерея витражей».
# ---------------------------------------------------------------------------

def area_gallery():
    H = 92
    m = Map(H, seed=10_002, cave=',')

    # --- Вход снизу: x 30…33.
    m.rect(30, 85, 33, H - 1)
    paint(m, 30, 85, 33, H - 1, 'r')

    # --- Притвор: x 22…41, ряды 77…84.
    m.rect(22, 77, 41, 84)
    paint(m, 30, 77, 33, 84, 'r')
    for (x, y) in ((23, 78), (40, 78)):
        m.put(x, y, 'y')
    for (x, y) in ((25, 83), (38, 83)):
        m.put(x, y, 'O')
    m.put(28, 79, '1')
    m.put(35, 79, '1')
    m.put(23, 84, 'U')
    m.put(24, 81, '&')
    m.put(39, 81, '&')
    m.put(40, 84, 'V')

    # --- Длинная галерея: x 3…55, ряды 58…75; посередине провал с
    # крестовым мостом, по краям — мраморные дорожки.
    m.rect(3, 58, 55, 75)
    m.rect(30, 76, 33, 76)
    paint(m, 3, 58, 55, 75, 'm')
    rough_chasm(m, 17, 62, 46, 71, seed_k=3.1)
    # Мост поперёк (запад — восток) и вдоль (к притвору и на север).
    m.rect(14, 66, 49, 68, 'h')
    m.rect(30, 60, 33, 74, 'h')
    paint(m, 30, 72, 33, 76, 'r', ok='mh.')
    # Колонны вдоль дорожек.
    for x in (6, 12, 49, 53):
        for y in (60, 73):
            m.put(x, y, 'O')
    # Канделябры и жаровни.
    for (x, y) in ((4, 59), (54, 59), (4, 74), (54, 74), (26, 59), (37, 59)):
        m.put(x, y, 'y')
    # Постаменты: живые горгульи (2) среди каменных (W).
    for (x, y, c) in ((9, 59, '2'), (15, 59, 'W'), (21, 59, '2'), (42, 59, 'W'),
                      (47, 59, '2'), (9, 74, 'W'), (21, 74, '2'), (42, 74, '2'), (47, 74, 'W')):
        m.put(x, y, c)
    # Битое стекло под окнами.
    paint(m, 3, 58, 55, 58, 'g', 0.35, ok='m')
    m.put(28, 72, 'R')                 # спящая стая на южной дорожке
    # Рыцари ада на концах поперечного моста — таранят вдоль него.
    m.put(12, 67, '5')
    m.put(51, 67, '5')
    speckle(m, 3, 58, 55, 75, 'k', 3, ok='m')

    # --- Двери на север: запад x 8…10 (к Витражному залу),
    # восток x 50…52 (к Часовне).
    m.rect(8, 51, 10, 57)
    m.rect(50, 51, 52, 57)

    # --- Витражный зал (зал-событие): x 3…27, ряды 29…50.
    m.rect(3, 29, 27, 50)
    paint(m, 3, 29, 27, 50, '4')
    for (x, y) in ((4, 30), (26, 30), (4, 49), (26, 49)):
        m.put(x, y, 'y')
    m.rect(14, 22, 16, 28)             # на север, к Апсиде

    # --- Часовня свечей: x 36…55, ряды 29…50.
    m.rect(36, 29, 55, 50)
    paint(m, 36, 29, 55, 50, 'm')
    # Руна посередине: круг из клеток.
    cx, cy = 47, 39
    for y in range(cy - 4, cy + 5):
        for x in range(cx - 5, cx + 6):
            d = ((x - cx) / 5.2) ** 2 + ((y - cy) / 4.2) ** 2
            if 0.45 < d <= 1.0 and m.g[y][x] == 'm':
                m.g[y][x] = 'j'
    m.put(cx, cy, '7')                 # алтарь пламени в центре руны
    for (x, y) in ((37, 30), (54, 30), (37, 49), (54, 49), (42, 34), (52, 34), (42, 44), (52, 44)):
        m.put(x, y, 'y')
    for (x, y) in ((53, 45), (38, 45), (54, 33)):
        m.put(x, y, 'U')
    m.put(46, 22, '.')
    m.rect(46, 22, 48, 28)             # на север, к Апсиде
    speckle(m, 36, 29, 55, 50, 'z', 5, ok='m')

    # --- Реликварий между залами: x 29…33, ряды 37…42, вход — треснувшая
    # стена из Часовни (x 35).
    m.rect(29, 37, 33, 42, 'm')
    m.protect(28, 36, 35, 43)
    for y in range(36, 44):
        m.set(34, y, '#')
        m.set(35, y, '#')
    m.put(35, 39, '%')
    m.put(34, 39, '.')
    m.put(31, 38, '$')
    m.put(29, 42, '+')
    m.put(33, 37, 'Z')

    # --- Апсида: x 12…51, ряды 9…21.
    m.rect(12, 9, 51, 21)
    paint(m, 12, 9, 51, 21, 'm')
    paint(m, 30, 9, 33, 21, 'r', ok='m')
    paint(m, 14, 15, 49, 15, 'r', ok='m')
    m.rect(30, 0, 33, 8)
    paint(m, 30, 0, 33, 8, 'r')
    for (x, y) in ((20, 11), (43, 11)):
        m.put(x, y, 'N')
    for (x, y) in ((13, 10), (50, 10), (13, 20), (50, 20)):
        m.put(x, y, 'i')
    for (x, y) in ((24, 12), (39, 12), (24, 19), (39, 19)):
        m.put(x, y, 'O')
    m.put(28, 10, '1')
    m.put(35, 10, '1')
    m.put(16, 18, '2')
    m.put(47, 18, 'W')
    m.put(12, 13, 'U')
    m.put(21, 17, '8')
    m.put(42, 17, '8')
    m.put(51, 17, 'V')

    # --- Служебный ход: с Апсиды (x 52) на восток и вниз, к притвору;
    # решётка на восточной стене притвора — открывается изнутри хода.
    m.rect(52, 12, 57, 14)
    m.rect(58, 12, 60, 82)
    m.rect(43, 80, 57, 82)
    m.put(42, 81, 'D')
    m.put(42, 80, '#')
    m.put(42, 82, '#')
    speckle(m, 58, 16, 60, 78, 'k', 3)

    # --- Настенное: витражи по северным стенам, знамёна, бра.
    for x in range(5, 55, 4):
        if m.g[57][x] == '#' and m.g[58][x] in FLOORISH:
            m.put(x, 57, 'w')
    for x in (6, 10, 18, 22):
        put_face(m, x, 28, 'w')
    for x in (39, 43, 51, 55):
        put_face(m, x, 28, 'w')
    for x in (18, 22, 26, 37, 41, 45):
        put_face(m, x, 8, 'w')
    put_face(m, 28, 8, 'F')
    m.put(28, 9, 'f')
    put_face(m, 35, 8, 'F')
    m.put(35, 9, 'f')
    for x in (24, 39):
        put_face(m, x, 76, 'n')
    for x in (27, 36):
        put_face(m, x, 76, 't')
    # Норы.
    for (x, y) in ((2, 62), (56, 70), (2, 40), (35, 32), (59, 44), (11, 21), (52, 20)):
        hole(m, x, y)
    return m


# ---------------------------------------------------------------------------
# Район 3 — «Тронный зал» (арена, печать, лестница).
# ---------------------------------------------------------------------------

ARENA = (19, 18, 44, 42)   # x0, y0, x1, y1 — внутренность Тронного зала
KX, KY = 32, 31            # трон


def area_throne():
    H = 96
    m = Map(H, seed=10_003, cave=',')
    ax0, ay0, ax1, ay1 = ARENA

    # --- Вход снизу: x 30…33.
    m.rect(30, 88, 33, H - 1)
    paint(m, 30, 88, 33, H - 1, 'r')

    # --- Зал присяги: x 14…49, ряды 72…87.
    m.rect(14, 72, 49, 87)
    paint(m, 14, 72, 49, 87, 'm')
    paint(m, 30, 72, 33, 87, 'r', ok='m')
    for x in (18, 24, 39, 45):
        for y in (75, 80, 85):
            m.put(x, y, 'O')
    for (x, y) in ((15, 73), (48, 73), (15, 86), (48, 86)):
        m.put(x, y, 'i')
    for (x, y) in ((28, 74), (35, 74), (21, 82), (42, 82)):
        m.put(x, y, '1')
    for (x, y) in ((16, 78), (47, 78)):
        m.put(x, y, 'U')
    m.put(21, 73, 'y')
    m.put(26, 78, '8')
    m.put(22, 84, '5')                 # рыцарь в колоннаде
    m.put(37, 78, '8')
    m.put(20, 86, 'e')
    m.put(43, 86, 'e')
    m.put(42, 73, 'y')

    # --- Старый подъёмник: запад, x 3…11, ряды 76…86; дверь x 12…13.
    m.rect(3, 76, 11, 86)
    m.rect(12, 79, 13, 81)
    m.floor(7, 81, 'E')
    m.put(4, 77, 'U')
    m.put(10, 85, 'V')

    # --- Шахта под троном: x 9…17, ряды 56…68; дверь с Зала присяги.
    m.rect(9, 56, 17, 68, ',', natural=True)
    m.rect(15, 69, 17, 71)
    m.wall_obj(13, 55, 'M')
    m.put(10, 66, 'U')
    m.put(16, 58, 'p')
    speckle(m, 9, 56, 17, 68, 'k', 3, ok=',')

    # --- Сокровищница (зал-ловушка): x 45…59, ряды 54…68; дверь с Зала
    # присяги x 46…48, ряды 69…71.
    m.rect(45, 54, 59, 68)
    paint(m, 45, 54, 59, 68, '6')
    m.rect(46, 69, 48, 71)
    m.put(52, 58, '$')
    paint(m, 50, 56, 54, 60, 'd', ok='6')
    for (x, y, c) in ((47, 56, '2'), (57, 56, '2'), (47, 65, '2'), (57, 65, '2'),
                      (52, 66, 'W'), (46, 61, '1')):
        m.put(x, y, c)
    for (x, y) in ((45, 54), (59, 54), (59, 68)):
        m.put(x, y, 'V')
    m.put(55, 61, 'U')

    # --- Путь процессий: от Зала присяги на север к воротам, x 30…34.
    m.rect(29, 44, 34, 71)
    paint(m, 29, 44, 34, 71, 'm')
    paint(m, 31, 44, 33, 71, 'r', ok='m')
    for (x, y) in ((29, 50), (34, 50), (29, 62), (34, 62)):
        m.put(x, y, 'i')
    for (x, y) in ((29, 56), (34, 56)):
        m.put(x, y, 'O')
    m.put(30, 44, 'T')
    for (x, y) in ((29, 47), (34, 47), (29, 59), (34, 59)):
        m.put(x, y, 'I')

    # --- Тронный зал (арена).
    m.rect(ax0, ay0, ax1, ay1)
    paint(m, ax0, ay0, ax1, ay1, 'm')
    # Ворота на юге.
    for x in (31, 32, 33):
        m.put(x, ay1 + 1, 'G')
    # Ковёр от ворот к помосту.
    paint(m, 31, KY + 2, 33, ay1, 'r', ok='m')
    # Помост трона.
    paint(m, 27, 26, 37, KY + 1, 'd', ok='m')
    m.put(KX, KY, 'K')
    m.put(KX, KY - 1, 'u')             # трон — за спиной короля
    # Колонны — два ряда.
    for x in (23, 41):
        for y in (22, 27, 32, 37):
            m.put(x, y, 'O')
    for (x, y) in ((20, 19), (43, 19), (20, 41), (43, 41)):
        m.put(x, y, 'i')
    for (x, y) in ((28, 25), (36, 25)):
        m.put(x, y, 'y')
    # Кости героев, дошедших до трона.
    for (x, y) in ((26, 39), (38, 36), (22, 30)):
        m.g[y][x] = 'k'
    # Двери стражи — норы в боковых стенах арены.
    for y in (27, 36):
        m.put(ax0 - 1, y, 'o')
        m.put(ax1 + 1, y, 'o')
    m.protect(ax0 - 2, ay0 - 2, ax1 + 2, ay1 + 2)

    # --- Печать и Лестница в бездну: от подъёмника на север, x 4…6.
    m.rect(4, 42, 6, 75)
    for x in (4, 5, 6):
        m.put(x, 73, 'S')
    m.rect(3, 28, 14, 41)
    paint(m, 3, 28, 14, 41, 'm')
    m.put(8, 33, '>')
    for (x, y) in ((4, 29), (13, 29)):
        m.put(x, y, 'i')
    m.put(13, 40, 'N')
    m.put(3, 40, '+')
    m.put(8, 40, 'Z')
    m.put(6, 33, '7')
    m.put(10, 33, '7')

    # --- Настенное.
    # Витражи на северной стене арены и Зала присяги.
    for x in range(ax0 + 1, ax1, 3):
        if m.g[ay0 - 1][x] == '#' and m.g[ay0][x] in FLOORISH:
            m.put(x, ay0 - 1, 'w')
    for x in (17, 21, 27, 36, 42, 46):
        if m.g[71][x] == '#' and m.g[72][x] in FLOORISH:
            m.put(x, 71, 'n')
    for x in (19, 44):
        if m.g[71][x] == '#' and m.g[72][x] in FLOORISH:
            m.put(x, 71, 't')
    for x in (5, 11):
        if m.g[27][x] == '#' and m.g[28][x] in FLOORISH:
            m.put(x, 27, 'w')
    for x in (48, 52, 56):
        if m.g[53][x] == '#' and m.g[54][x] in FLOORISH:
            m.put(x, 53, 'J')
    # Кровавый фонтан в стене Зала присяги — на западе.
    put_face(m, 26, 71, 'F')
    m.put(26, 72, 'f')
    # Норы — только вне арены.
    for (x, y) in ((13, 74), (50, 76), (2, 80), (60, 60), (8, 55), (28, 60), (35, 66)):
        hole(m, x, y)
    return m


# ---------------------------------------------------------------------------
# Проверки: связность, арена, печать — как в договоре этажей.
# ---------------------------------------------------------------------------

WALK = set('.,rmkxzqh^sgdj461235e+~E!=cCBXnvPl$TK>uaRAINW&UVZ87p*0fyiO')
PASS = WALK | set('DG%')
DEEP = set('_')
SOLID_OBJ = set('iyOUVZWANI&87p*0uCBX')


def bfs(rows, sx, sy, passable):
    H = len(rows)
    seen = [[False] * W for _ in range(H)]
    q = deque([(sx, sy)])
    seen[sy][sx] = True
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and not seen[ny][nx] and passable(rows[ny][nx]):
                seen[ny][nx] = True
                q.append((nx, ny))
    return seen


def find(rows, ch):
    return [(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == ch]


def verify(areas):
    # Мир — районы снизу вверх: сверху самый глубокий.
    world = []
    for rows in reversed(areas):
        world += rows
    lift = find(areas[0], 'E')[0]
    top0 = len(world) - len(areas[0])
    lx, ly = lift[0], lift[1] + top0
    walkable = lambda c: c in PASS or c == 'S'
    sealed = lambda c: c in PASS
    seen = bfs(world, lx, ly, walkable)
    closed = bfs(world, lx, ly, sealed)
    k = find(world, 'K')[0]
    assert seen[k[1]][k[0]], 'босс недостижим'
    for (x, y) in find(world, 'M'):
        assert seen[y + 1][x], ('шахта недостижима', x, y)
    for (x, y) in find(world, '>'):
        assert seen[y][x], 'лестница недостижима с открытой печатью'
        assert not closed[y][x], 'к лестнице можно пройти мимо печати'
    # Арена: заливка пола от K; выходы — только ворота.
    arena_walk = lambda c: c in WALK
    arena = bfs(world, k[0], k[1], arena_walk)
    n = sum(1 for r in arena for v in r if v)
    assert 40 < n < 1500, ('площадь арены', n)
    assert not arena[ly][lx], 'лифт внутри арены'
    for (x, y) in find(world, '>'):
        assert not arena[y][x], 'лестница внутри арены'
    for (x, y) in find(world, 'T'):
        d = ((x - k[0]) ** 2 + (y - k[1]) ** 2) ** 0.5
        if d < 14:
            print(f'  табличка логова в {d:.1f} от трона', file=sys.stderr)
    # Все клетки пола достижимы (кроме тайников за трещинами — через %).
    lost = [(x, y) for y, r in enumerate(world) for x, c in enumerate(r)
            if c in WALK and not seen[y][x]]
    assert not lost, ('недостижимый пол', lost[:10])
    print(f'  арена {n} клеток, мир {len(world)} рядов', file=sys.stderr)


# ---------------------------------------------------------------------------
# Лист спрайтов из тайлов DCSS (CC0): `--sprites <каталог rltiles>`.
# ---------------------------------------------------------------------------
#
# Тайлы берутся из crawl/crawl (crawl-ref/source/rltiles, CC0) — качать по
# одному через raw.githubusercontent.com, пути ниже. Всё чужое проходит
# палитру подземелья: камень — холодная ступенчатая гамма чёрного камня
# замка, кровь и огонь — два акцента этажа, кость — своя гамма. Контур —
# тёмный снаружи. Клетка листа 32×32, порядок — `SHEET` (тот же порядок в
# `f10-art.ts`, `F10_SHEET`).

# Горгульи на листе НЕТ: `war_gargoyle.png` стоит в списке тайлов с неясной
# лицензией (github.com/crawl/tiles, TILES_UNDER_UNKNOWN_LICENSE.md) —
# горгулья нарисована кодом в `f10-art.ts`. Остальные файлы в том списке
# не значатся; общая лицензия тайлов — CC0.
SHEET = [
    ('devil', 'dngn/statues/statue_depths_zot_devil.png', 'stone'),
    ('lord', 'dngn/statues/statue_depths_asmodeus.png', 'stone'),
    ('iron', 'dngn/statues/statue_iron.png', 'mono'),
    ('polearm', 'dngn/statues/statue_polearm.png', 'stone'),
    ('font0', 'dngn/decor/blood_fountain.png', 'stone'),
    ('font1', 'dngn/decor/blood_fountain2.png', 'stone'),
    ('flame0', 'dngn/altars/makhleb_flame1.png', 'stone'),
    ('flame1', 'dngn/altars/makhleb_flame2.png', 'stone'),
    ('skulls', 'dngn/altars/kikubaaqudgha.png', 'bone'),
]

# Гаммы: от тени к блику.
RAMP_STONE = ['#120e12', '#1f191f', '#2e2630', '#433843', '#5c4f5c', '#7c6c7a', '#a4929e']
RAMP_IRON = ['#160e0c', '#2a1814', '#40261c', '#5a3624', '#7a4a2e', '#9a6640', '#c08a5a']
RAMP_BLOOD = ['#2a0608', '#4e0a10', '#7a1218', '#a81c22', '#d6302e', '#ff5a46']
RAMP_FIRE = ['#5a1206', '#9a2c08', '#d85a10', '#f89a24', '#ffd060', '#fff4b0']
RAMP_BONE = ['#2e2620', '#4e4234', '#76684e', '#a09070', '#cabb98', '#ece2c6']
RAMP_EYE = ['#6a0a0a', '#c01414', '#ff3a2a', '#ffb0a0']


def _hex(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def _pick(ramp, l):
    """Ступень гаммы по светлоте 0…1."""
    i = max(0, min(len(ramp) - 1, int(l * len(ramp))))
    return _hex(ramp[i])


def recolor(im, base):
    import colorsys
    from PIL import Image
    im = im.convert('RGBA')
    px = im.load()
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    po = out.load()
    # Светлота — по всему спрайту: тени и блики растягиваются на гамму.
    ls = []
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a:
                ls.append((0.299 * r + 0.587 * g + 0.114 * b) / 255)
    lo = sorted(ls)[int(len(ls) * 0.02)] if ls else 0
    hi = sorted(ls)[int(len(ls) * 0.98)] if ls else 1
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            l = (0.299 * r + 0.587 * g + 0.114 * b) / 255
            k = max(0.0, min(0.999, (l - lo) / max(0.05, hi - lo)))
            hue = h * 360
            if r + g + b < 14:
                # Контур DCSS — в тушь подземелья.
                po[x, y] = _hex('#150f0b') + (255,)
                continue
            if base == 'mono':
                # Статуя целиком из камня: ржавчина исходника не становится огнём.
                c = _pick(RAMP_STONE, k)
            elif s > 0.45 and v > 0.3 and (hue < 16 or hue > 335):
                c = _pick(RAMP_BLOOD, k * 0.8 + 0.2)
            elif s > 0.4 and v > 0.35 and 16 <= hue < 62:
                c = _pick(RAMP_FIRE, k * 0.62 + 0.22)
            elif base == 'bone':
                c = _pick(RAMP_BONE, k)
            elif base == 'iron':
                c = _pick(RAMP_IRON, k)
            else:
                c = _pick(RAMP_STONE, k)
            po[x, y] = c + (255,)
    # Контур у тайлов DCSS свой (почти чёрный) — он уже стал тушью; где
    # его нет, дорисуем снаружи.
    ink = _hex('#150f0b') + (255,)
    add = []
    for y in range(out.height):
        for x in range(out.width):
            if po[x, y][3]:
                continue
            if any(0 <= x + dx < out.width and 0 <= y + dy < out.height and po[x + dx, y + dy][3]
                   and po[x + dx, y + dy] != ink
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                add.append((x, y))
    for x, y in add:
        po[x, y] = ink
    return out


def sprites(src, dst):
    from PIL import Image
    cols = 5
    rows = (len(SHEET) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * 32, rows * 32), (0, 0, 0, 0))
    for n, (name, path, base) in enumerate(SHEET):
        im = Image.open(os.path.join(src, path))
        im = recolor(im, base)
        sheet.paste(im, ((n % cols) * 32, (n // cols) * 32), im)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    sheet.save(dst, optimize=True)
    print('записано', dst, sheet.size, file=sys.stderr)


if __name__ == '__main__' and '--sprites' in sys.argv:
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
    sprites(sys.argv[sys.argv.index('--sprites') + 1],
            os.path.join(root, 'public', 'dungeon', 'f10', 'sheet.png'))
    sys.exit(0)


if __name__ == '__main__':
    a = area_gates()
    b = area_gallery()
    c = area_throne()
    ra = check(a, 'f10')
    rb = check(b, 'f10gallery')
    rc = check(c, 'f10throne')
    if '--show' in sys.argv:
        show(rc, 'C')
        show(rb, 'B')
        show(ra, 'A')
    verify([ra, rb, rc])
    write_floor(10, {'MAP_F10_GATES': ra, 'MAP_F10_GALLERY': rb, 'MAP_F10_THRONE': rc},
                note='Район 1 — «Врата преисподней» (вход), 2 — «Галерея витражей», '
                     '3 — «Тронный зал» (арена).')
