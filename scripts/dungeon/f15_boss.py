"""Этаж 15 «Ядро подземелья» — верхний район «Ядро» (агент «Сердце»).

На дне подземелья лежит упавшая звезда. Район снизу вверх:

  Кристальные арки — коридор 8 клеток от стыка с «Миром» (столбцы F15_JOIN
                28–35): пары кристальных столбов-арок, пыль звезды на полу.
  Перекрёсток лучей — овальный зал-развилка: прямо — к Залу памяти, налево
                — Жила (длинная тропа с тайником за треснувшей стеной и
                решёткой в Зал памяти, открывается из зала), направо — Грот
                жеод (жеоды бьются, из пор лезут осколки звезды), из грота —
                второй вход в Зал памяти.
  Зал памяти  — мраморный зал с колоннами и световой дорожкой к воротам; в
                северной стене шесть ниш: корона Крысиного короля, секира
                Минотавра, череп Красного змея, голова гидры, меч Короля
                демонов — каждая в кристалле — и шестая, пустая: она ждёт
                героя. У ворот — табличка, в зале спят два Хранителя памяти.
  Арена       — круглый зал R=13 вокруг упавшей звезды (центр 31,5; 29,5).
                Пол — звёздная карта: золотые кольца астролябии, меридианы,
                созвездия; по краю — восемь кольцевых стоек армиллярной
                сферы; четыре спящих знака памяти в четвертях (лава, бездна,
                зеркала, круги гидры) — их будит третья фаза боя.
  Колыбель    — за звездой, в северной стене, печать; за ней лестница вниз
                (задел на будущее).

Запуск: python3 scripts/dungeon/f15_boss.py [--show] — пишет
src/lib/dungeon-floors/f15-boss-map.ts (руками не править). Зерно
постоянное, повторный запуск даёт тот же файл байт в байт.

Свои буквы (легенда — `F15_HEART_AREA.legend` в f15-boss.ts):
  f  звёздная карта (пол арены)   q  кратер звезды     h  мрамор Зала памяти
  j  световая дорожка            w  кристальный грунт  y  звёздная пыль
  1  знак лавы  2  знак бездны  3  знак зеркал  4  знак гидры (3×3)
  W  порода с кристаллом         Q  лицо стены с друзой (светится)
  H  стена зала с золотой пилястрой
  A  корона  N  секира  O  череп змея  U  голова гидры  Z  меч  7  пустая ниша
  F  упавшая звезда (над кратером, сквозь неё ходят)
  g  стойка армиллярной сферы    p  колонна зала       k  столб арки
  s  жеода (бьётся)              e  звёздный светильник
  t  искры на полу (живые)       x  кристальный сталагмит
"""
import math
import os
import sys
from collections import deque

sys.path.insert(0, os.path.dirname(__file__))
from brush import Map, W, show, ts  # noqa: E402

H = 104
JOIN = (28, 35)
# Арена: центр (между клетками нет — центр клетки 31,29) и радиус.
CX, CY, R = 31.5, 29.5, 13.0
KX, KY = 31, 31
GATE_Y = 43
GATE = (30, 32)
SEAL_Y = 13
STAIRS = (31, 6)
FLOORISH = set('fqhjwy1234FgpkseTtx$>K.')


def dist(x, y):
    return math.hypot(x + 0.5 - CX, y + 0.5 - CY)


def blob(m, cx, cy, rx, ry, c, rough_k=0.12, seed=0.0):
    for y in range(int(cy - ry) - 2, int(cy + ry) + 3):
        for x in range(1, W - 1):
            dx = (x + 0.5 - cx) / rx
            dy = (y + 0.5 - cy) / ry
            a = math.atan2(dy, dx)
            k = 1 + rough_k * (0.6 * math.sin(3 * a + seed) + 0.4 * math.sin(7 * a + seed * 2.3))
            if dx * dx + dy * dy <= k * k and 0 <= y < m.h:
                m.set(x, y, c)


def main(show_map=False):
    m = Map(H, seed=1515, cave='w')

    # --- Колыбель: грот за печатью, лестница вниз.
    blob(m, 31.5, 6.5, 5.6, 3.3, 'w', 0.1, 1.3)
    m.rect(30, 9, 32, 15, 'w')

    # --- Арена: ровный круг (построенный зал, а не пещера).
    for y in range(int(CY - R) - 1, int(CY + R) + 2):
        for x in range(1, W - 1):
            if dist(x, y) <= R:
                m.set(x, y, 'f')
    # Горло к воротам и к печати: по три клетки.
    m.rect(GATE[0], 41, GATE[1], 42, 'f')
    m.rect(30, 14, 32, 17, 'f')

    # --- Зал памяти: вытянутый восьмиугольник.
    for y in range(44, 56):
        for x in range(15, 49):
            cut = max(0, 3 - (y - 44), 3 - (55 - y))
            if 15 + cut <= x <= 48 - cut:
                m.set(x, y, 'h')
    # Выход из зала на юг — к аркам.
    m.rect(28, 56, 35, 58, 'w')

    # --- Кристальные арки (верхний отрезок): от зала вниз и с изгибом влево.
    m.rect(28, 58, 35, 66, 'w')
    for y in range(67, 77):
        sh = min(4, (y - 66) // 2)
        m.rect(28 - sh, y, 35 - sh, y, 'w')
    m.rect(24, 76, 31, 78, 'w')

    # --- Перекрёсток лучей: зал-развилка.
    blob(m, 31.0, 82.5, 9.0, 4.6, 'w', 0.1, 0.7)

    # --- Кристальные арки (нижний отрезок) до стыка.
    m.rect(JOIN[0], 86, JOIN[1], H - 1, 'w')

    # --- Налево: Жила — на запад, вверх, к гроту с тайником и к залу.
    m.rect(14, 81, 23, 83, 'w')
    m.rect(13, 58, 15, 83, 'w')
    m.rect(13, 57, 15, 58, 'w')
    m.rect(11, 49, 13, 57, 'w')
    blob(m, 9.5, 64.5, 3.6, 3.0, 'w', 0.12, 2.0)
    m.rect(10, 63, 13, 66, 'w')
    # Тайник за треснувшей стеной (на западе грота).
    m.rect(2, 63, 4, 66, 'w')

    # --- Направо: Грот жеод и второй вход в зал.
    m.rect(40, 82, 49, 84, 'w')
    blob(m, 52.5, 73.5, 6.2, 7.2, 'w', 0.14, 3.1)
    m.rect(50, 58, 52, 67, 'w')
    m.rect(48, 52, 52, 58, 'w')

    rows = [list(r) for r in m.g]

    def put(x, y, c):
        rows[y][x] = c

    def get(x, y):
        if not (0 <= x < W and 0 <= y < H):
            return '#'
        return rows[y][x]

    # --- Объекты движка.
    for x in range(30, 33):
        put(x, SEAL_Y, 'S')
    put(*STAIRS, '>')
    for x in range(GATE[0], GATE[1] + 1):
        put(x, GATE_Y, 'G')
    put(29, 44, 'T')
    put(KX, KY, 'K')
    # Звезда — в центре арены (клетка 31,29).
    put(31, 29, 'F')
    # Тайник и треснувшая стена к нему.
    put(3, 64, '$')
    put(5, 64, '%')
    put(5, 65, '#')
    put(5, 63, '#')
    # Решётка: из Зала памяти в Жилу — открывается со стороны зала (востока).
    for y in (49, 50):
        put(14, y, 'D')
    for y in range(49, 51):
        put(15, y, 'h')

    # --- Пол арены: кратер, знаки памяти.
    for y in range(16, 43):
        for x in range(18, 46):
            if get(x, y) == 'f' and dist(x, y) <= 2.6:
                put(x, y, 'q')
    quads = {
        '1': (KX - 7, 23),   # СЗ — лава
        '2': (KX + 7, 23),   # СВ — бездна
        '3': (KX - 7, 36),   # ЮЗ — зеркала
        '4': (KX + 7, 36),   # ЮВ — круги гидры
    }
    for ch, (qx, qy) in quads.items():
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                assert get(qx + dx, qy + dy) == 'f', ('знак мимо пола', ch, qx + dx, qy + dy)
                put(qx + dx, qy + dy, ch)

    # Световая дорожка Зала памяти — от выхода к воротам.
    for y in range(44, 59):
        for x in range(30, 33):
            if get(x, y) in 'hw':
                put(x, y, 'j')

    rng = m.rng

    def speckle(x0, y0, x1, y1, ch, n, ok='w', gap=3):
        cells = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1) if get(x, y) in ok]
        rng.shuffle(cells)
        placed = []
        for (x, y) in cells:
            if len(placed) >= n:
                break
            if any(abs(x - a) + abs(y - b) < gap for a, b in placed):
                continue
            put(x, y, ch)
            placed.append((x, y))
        return placed

    # Звёздная пыль пятнами — в арках, перекрёстке и гротах.
    for (x, y) in speckle(10, 57, 58, H - 2, 'y', 22, gap=5):
        for dx, dy in ((1, 0), (0, 1), (-1, 0)):
            if get(x + dx, y + dy) == 'w' and rng.random() < 0.6:
                put(x + dx, y + dy, 'y')

    # --- Стены: всё, что граничит с полом района, — порода с кристаллом.
    wall_letter = [[None] * W for _ in range(H)]
    for y in range(H):
        for x in range(1, W - 1):
            if get(x, y) != '#':
                continue
            near = any(get(x + dx, y + dy) in FLOORISH or get(x + dx, y + dy) in 'SGD>K%'
                       for dy in (-2, -1, 0, 1, 2) for dx in (-2, -1, 0, 1, 2))
            if near and y < H - 1:
                wall_letter[y][x] = 'W'
    for y in range(H):
        for x in range(W):
            if wall_letter[y][x]:
                put(x, y, wall_letter[y][x])

    def face_ok(x, y, want='W'):
        return get(x, y) == want and get(x, y + 1) in FLOORISH

    def faces(y0, y1, x0=1, x1=W - 2):
        return [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1) if face_ok(x, y)]

    # Ниши реликвий — северная стена Зала памяти, по порядку этажей слева
    # направо; шестая — пустая.
    relics = {18: 'A', 21: 'N', 24: 'O', 38: 'U', 41: 'Z', 44: '7'}
    for x, ch in relics.items():
        assert face_ok(x, GATE_Y), ('нет стены под реликвию', ch, x, get(x, GATE_Y), get(x, GATE_Y + 1))
        put(x, GATE_Y, ch)
    # Пилястры зала: между нишами и по стенам зала.
    for (x, y) in faces(40, 58, 14, 50):
        if get(x, y) == 'W':
            put(x, y, 'H')

    # Лица стен арены: друзы по кругу через одну-две.
    ring = faces(12, 42, 16, 47)
    ring.sort(key=lambda p: math.atan2(p[1] + 0.5 - CY, p[0] + 0.5 - CX))
    for i, (x, y) in enumerate(ring):
        if get(x, y) == 'W' and i % 3 == 1:
            put(x, y, 'Q')
    # Колыбель и арки: друзы реже.
    for i, (x, y) in enumerate(faces(1, 11) + faces(57, H - 2)):
        if get(x, y) == 'W' and i % 4 == 2:
            put(x, y, 'Q')

    # --- Предметы на полу.
    def floor_obj(x, y, c, ok='w'):
        if get(x, y) in ok:
            put(x, y, c)
            return True
        for r in (1, 2):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if get(x + dx, y + dy) in ok:
                        print(f'  сдвиг {c} ({x},{y}) -> ({x+dx},{y+dy})', file=sys.stderr)
                        put(x + dx, y + dy, c)
                        return True
        raise AssertionError(('no floor near', x, y, c))

    # Восемь стоек армиллярной сферы по кругу у стены.
    for i in range(8):
        a = (i + 0.5) * (2 * math.pi / 8)
        x = int(math.floor(CX + math.cos(a) * 11.2))
        y = int(math.floor(CY + math.sin(a) * 11.2))
        floor_obj(x, y, 'g', ok='f')
    # Искры звёздной карты (живые, плоские) — внутри арены.
    for (x, y) in ((25, 20), (38, 20), (22, 29), (41, 29), (26, 39), (37, 39), (31, 19), (19, 25), (44, 33)):
        if get(x, y) == 'f':
            put(x, y, 't')
    # Сталагмиты-кристаллы у стены арены (не на пути боя).
    for i in range(6):
        a = (i + 0.25) * (2 * math.pi / 6) + 0.2
        x = int(math.floor(CX + math.cos(a) * 12.3))
        y = int(math.floor(CY + math.sin(a) * 12.3))
        if get(x, y) == 'f' and abs(x - 31) > 3:
            put(x, y, 'x')

    # Зал памяти: две колоннады, светильники, Хранители спят посередине.
    for x in (20, 26, 37, 43):
        floor_obj(x, 47, 'p', ok='h')
        floor_obj(x, 52, 'p', ok='h')
    for (x, y) in ((17, 49), (46, 49), (28, 54), (35, 54)):
        floor_obj(x, y, 'e', ok='h')
    put(24, 50, 'R')
    put(39, 50, 'R')

    # Арки: пары столбов по краям коридоров.
    for y in (61, 66, 90, 95, 100):
        floor_obj(JOIN[0], y, 'k', ok='wy')
        floor_obj(JOIN[1], y, 'k', ok='wy')
    for y in (71,):
        floor_obj(25, y, 'k', ok='wy')
        floor_obj(32, y, 'k', ok='wy')
    # Перекрёсток: светильник посередине, сталагмиты по краям.
    floor_obj(31, 82, 'e', ok='wy')
    for (x, y) in ((24, 80), (38, 80), (26, 85), (37, 85)):
        floor_obj(x, y, 'x', ok='wy')
    # Грот жеод: жеоды бьются, в них пыль.
    for (x, y) in ((49, 70), (55, 69), (52, 76), (56, 77), (48, 78), (54, 73)):
        floor_obj(x, y, 's', ok='wy')
    floor_obj(52, 72, 'e', ok='wy')
    # Жила и грот тайника.
    floor_obj(14, 70, 'x', ok='wy')
    floor_obj(9, 66, 's', ok='wy')
    floor_obj(11, 62, 'e', ok='wy')
    floor_obj(3, 65, 's', ok='wy')
    # Колыбель: сталагмиты вокруг лестницы.
    for (x, y) in ((27, 6), (35, 6), (29, 4), (33, 4)):
        floor_obj(x, y, 'x', ok='w')

    # Поры-жеоды в стенах: из них лезут осколки звезды.
    def pore(x, y):
        for r in range(0, 5):
            for dx, dy in ((0, 0), (-r, 0), (r, 0), (0, -r), (0, r)):
                xx, yy = x + dx, y + dy
                if get(xx, yy) in 'WQ' and any(get(xx + a, yy + b) in 'wy' for a, b in ((0, 1), (1, 0), (-1, 0), (0, -1))):
                    put(xx, yy, 'o')
                    return
        raise AssertionError(('нет места под пору', x, y))

    pore(58, 73)
    pore(47, 67)
    pore(27, 92)
    pore(36, 98)
    pore(12, 75)

    # Последний ряд — стык: пол ровно в столбцах JOIN, остальное — порода.
    last = ['#'] * W
    for x in range(JOIN[0], JOIN[1] + 1):
        last[x] = 'w'
    rows[H - 1] = last
    for y in range(H):
        rows[y][0] = '#'
        rows[y][W - 1] = '#'

    out = [''.join(r) for r in rows]
    verify(out)
    if show_map:
        show(out)
    return out


def verify(rows):
    """Всё главное достижимо от стыка; арена замкнута воротами."""
    walk = set('fqhjwy1234FgpkseTtx$>K.R')

    def ok(c, gate=True, seal=False, grate=True, crack=True):
        return c in walk or (gate and c == 'G') or (seal and c == 'S') or (grate and c == 'D') or (crack and c == '%')

    def bfs(sx, sy, **kw):
        seen = {(sx, sy)}
        q = deque([(sx, sy)])
        while q:
            x, y = q.popleft()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < len(rows) and (nx, ny) not in seen and ok(rows[ny][nx], **kw):
                    seen.add((nx, ny))
                    q.append((nx, ny))
        return seen

    start = (31, len(rows) - 1)
    seen = bfs(*start)
    find = lambda ch: [(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == ch]
    (kx, ky), = find('K')
    assert (kx, ky) in seen, 'до звезды не дойти'
    for ch in 'T$R':
        for p in find(ch):
            assert p in seen, ('не дойти до', ch, p)
    # Без решётки и треснувшей стены зал всё равно достижим (два пути).
    plain = bfs(*start, grate=False, crack=False)
    assert (kx, ky) in plain, 'главный путь закрыт решёткой'
    stairs = find('>')
    for s in stairs:
        assert s not in seen, 'лестница мимо печати'
    opened = bfs(*start, seal=True)
    for s in stairs:
        assert s in opened, 'после победы до лестницы не дойти'
    arena = bfs(kx, ky, gate=False, grate=False, crack=False)
    assert 40 < len(arena) < 1500, ('площадь арены', len(arena))
    assert not any(y >= GATE_Y for _, y in arena), 'арена протекла за ворота'
    tx, ty = find('T')[0]
    assert math.hypot(tx - kx, ty - ky) < 13.9, ('табличка далеко', math.hypot(tx - kx, ty - ky))
    last = rows[-1]
    assert [i for i, c in enumerate(last) if c != '#'] == list(range(JOIN[0], JOIN[1] + 1)), 'стык'
    print(f'арена {len(arena)} клеток, табличка в {math.hypot(tx - kx, ty - ky):.1f} от K', file=sys.stderr)


def write(rows):
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
    path = os.path.join(root, 'src', 'lib', 'dungeon-floors', 'f15-boss-map.ts')
    head = (
        '// Карта района «Ядро» этажа 15 — собрана скриптом scripts/dungeon/f15_boss.py\n'
        '// (кисти brush.py). Руками не править: запустите скрипт, он перепишет файл.\n'
        '// Нижний ряд — стык с «Миром»: пол ровно в столбцах F15_JOIN (28–35).\n'
    )
    geo = (
        '/** Геометрия района: центр арены и звезды, радиус арены, ворота, зал. */\n'
        'export const F15B_GEO = {\n'
        f'  cx: {CX},\n  cy: {CY},\n  r: {R},\n  gateY: {GATE_Y},\n'
        f'  hall: {{ x0: 15, y0: 44, x1: 48, y1: 55 }},\n'
        f'  rows: {H},\n'
        '} as const;\n'
    )
    with open(path, 'w') as f:
        f.write(head + '\n' + geo + '\n' + ts('F15_HEART_MAP', rows))
    print('записано', os.path.relpath(path, root), file=sys.stderr)


if __name__ == '__main__':
    rows = main('--show' in sys.argv)
    for r in rows:
        assert len(r) == W and r[0] == '#' and r[-1] == '#'
    write(rows)
