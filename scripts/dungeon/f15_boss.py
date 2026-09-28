"""Этаж 15 «Сердце подземелья» — район «Сердце» (агент «Сердце», v2.83).

Верхний район этажа: здесь бьётся подземелье. Снизу вверх:

  Горловина   — коридор 8 клеток от стыка с «Сосудами» (столбцы F15_JOIN
                28–35): рёбра по стенам, вены на полу сходятся к сердцу,
                слева — жилка к тайнику за треснувшей стеной, справа —
                обходная жилка с решёткой (короткий путь назад).
  Преддверие  — живой зал перед клапаном: пять ниш с реликвиями пяти
                боссов (корона Крысиного короля, секира Минотавра, череп
                Красного змея, голова гидры, меч Короля демонов) — это
                отголоски, которые встанут в бою первыми; табличка у двери.
  Камера      — арена: огромный овал 29×27, мышечные стены с венами,
                глазами и полипами, веер вен от сердца, кольцо корней,
                восемь рёбер-арок, четыре спящих знака памяти в четвертях
                (лава, бездна, зеркала, круги гидры) — в фазе «ПОДЗЕМЕЛЬЕ
                ПОМНИТ» четверти переписываются под них. Кокон — в центре.
  Устье       — за сердцем, в северной стене, клапан-печать; за ним
                лестница вниз (задел на будущее).

Запуск: python3 scripts/dungeon/f15_boss.py [--show] — пишет
src/lib/dungeon-floors/f15-boss-map.ts (руками не править). Зерно
постоянное, повторный запуск даёт тот же файл байт в байт.

Свои буквы (легенда — `F15_HEART_AREA.legend` в f15-boss.ts):
  f  плоть (пол)             r  вена на полу (светится)   x  кровь
  m  пластины-чешуя у сердца h  корни сердца             k  костяная вставка
  1  знак лавы               2  знак бездны              3  знак зеркал
  4  знак гидры (спящие знаки памяти — 3×3 в центре четверти)
  W  мышечная стена          V  стена с толстой веной    Q  стена с рёбрами
  I  глаз в стене            J  полип-светильник         H  губа клапана
  A  корона (реликвия)       N  секира (реликвия)        O  череп змея
  U  голова гидры            Z  меч Короля демонов
  F  кокон сердца (под K)    g  ребро-арка               p  сухожилие-столб
  s  пузырь (бьётся)         d  капель                   e  жерло пара
  t  зубы из пола            5  кости                    6  нервный узел
"""
import math
import os
import sys
from collections import deque

sys.path.insert(0, os.path.dirname(__file__))
from brush import Map, W, check, show, ts  # noqa: E402

H = 78
JOIN = (28, 35)
# Камера сердца: центр и полуоси овала.
CX, CY, RX, RY = 31.5, 29.5, 14.6, 13.6
KX, KY = 31, 32
GATE_Y = 45
FLOORISH = set('.frxmhk1234Fgpsdet56T$,')


def rough(a, ph):
    return 1 + 0.035 * math.sin(3 * a + ph[0]) + 0.025 * math.sin(5 * a + ph[1]) + 0.02 * math.sin(9 * a + ph[2])


def chamber(m):
    """Камера сердца — гладкий живой овал (не рваная пещера)."""
    ph = (0.7, 2.1, 4.4)
    for y in range(int(CY - RY) - 2, int(CY + RY) + 3):
        for x in range(1, W - 1):
            dx = (x + 0.5 - CX) / RX
            dy = (y + 0.5 - CY) / RY
            a = math.atan2(dy, dx)
            if dx * dx + dy * dy <= rough(a, ph) ** 2:
                m.set(x, y, 'f')


def blob(m, cx, cy, rx, ry, c='f', rough_k=0.12, seed=0.0):
    for y in range(int(cy - ry) - 2, int(cy + ry) + 3):
        for x in range(1, W - 1):
            dx = (x + 0.5 - cx) / rx
            dy = (y + 0.5 - cy) / ry
            a = math.atan2(dy, dx)
            k = 1 + rough_k * (0.6 * math.sin(3 * a + seed) + 0.4 * math.sin(7 * a + seed * 2.3))
            if dx * dx + dy * dy <= k * k and 0 <= y < m.h:
                m.set(x, y, c)


def main(show_map=False):
    m = Map(H, seed=1515, cave='f')

    # --- Устье: клапан-печать и лестница вниз (за сердцем, на севере).
    blob(m, 31.5, 6.5, 6.2, 3.4, 'f', 0.08, 1.3)
    m.rect(30, 10, 33, 15, 'f')

    # --- Камера сердца.
    chamber(m)
    # Горло клапана под камерой (воронка) и сами ворота.
    m.rect(29, 41, 34, 42, 'f')
    m.rect(30, 43, 33, 44, 'f')

    # --- Преддверие: живой зал, северный край ровный — там ниши реликвий.
    blob(m, 31.5, 55.0, 11.2, 7.0, 'f', 0.1, 0.4)
    m.rect(21, 46, 42, 49, 'f')
    # Горловина до стыка — 8 в ширину, ровно в столбцах стыка на последнем ряду.
    m.rect(JOIN[0], 61, JOIN[1], H - 1, 'f')
    # Горловина живая: стены чуть «дышат» ниже преддверия (но не у стыка).
    for y in range(64, H - 4):
        if math.sin(y * 0.9) > 0.55:
            m.set(JOIN[0] - 1, y, 'f')
            m.set(JOIN[1] + 1, y, 'f')

    # --- Развилка. Левая жилка: от горловины на запад и вверх, в западный
    # край преддверия; по пути — треснувшая стена к тайнику.
    m.rect(17, 69, 27, 70, 'f')
    m.rect(15, 51, 16, 70, 'f')
    m.rect(15, 51, 21, 52, 'f')
    m.rect(9, 57, 12, 61, 'f')
    # Правая жилка: от горловины на восток и вверх, в Пазуху — нишу с
    # пузырями; из Пазухи в преддверие — решётка (открывается с востока).
    m.rect(36, 66, 49, 67, 'f')
    m.rect(48, 52, 49, 67, 'f')
    blob(m, 51.5, 54.5, 3.4, 3.2, 'f', 0.1, 2.2)
    m.rect(40, 52, 47, 53, "f")

    rows = [list(r) for r in m.g]

    def put(x, y, c):
        rows[y][x] = c

    def get(x, y):
        if not (0 <= x < W and 0 <= y < H):
            return '#'
        return rows[y][x]

    # --- Объекты движка.
    # Печать-клапан (ряд 14, столбцы 30–33) и лестница.
    for x in range(30, 34):
        put(x, 15, 'S')
    put(31, 6, '>')
    # Ворота арены и табличка в нише у двери (снаружи).
    for x in range(30, 34):
        put(x, GATE_Y, 'G')
    put(28, GATE_Y, 'T')
    put(28, GATE_Y + 1, 'f')
    # Логово: K — сердце; кокон стоит под ним (предмет на клетке ниже).
    put(KX, KY, 'K')
    put(KX, KY + 1, 'F')
    # Тайник и треснувшая стена к нему (из левой жилки на запад).
    put(10, 59, '$')
    put(13, 59, '%')
    put(14, 59, 'f')
    # Решётка — короткий путь из Пазухи в преддверие (открывается с востока).
    put(45, 52, 'D')
    put(45, 53, 'D')

    # --- Пол: вены веером от сердца к стенам камеры.
    def in_chamber(x, y):
        return 12 <= y <= GATE_Y and get(x, y) not in '#'

    for i in range(10):
        ang = -math.pi / 2 + (i + 0.5) * (2 * math.pi / 10) + 0.12 * math.sin(i * 2.7)
        wob = 0.35 + 0.1 * (i % 3)
        for s in range(40, 170):
            d = s * 0.1
            a = ang + wob * math.sin(d * 0.55 + i) * 0.18
            x = int(math.floor(KX + 0.5 + math.cos(a) * d))
            y = int(math.floor(KY + 0.5 + math.sin(a) * d * 0.95))
            if not in_chamber(x, y):
                break
            if get(x, y) == 'f':
                put(x, y, 'r')

    # Корни сердца: кольцо у кокона.
    for y in range(KY - 4, KY + 5):
        for x in range(KX - 5, KX + 6):
            d = math.hypot((x - KX) / 1.15, y - KY)
            if 2.2 <= d <= 3.6 and get(x, y) in 'fr':
                put(x, y, 'h')
            elif d < 2.2 and get(x, y) in 'fr':
                put(x, y, 'm')

    # Спящие знаки памяти: 3×3 в центре каждой четверти.
    quads = {
        '1': (KX - 8, KY - 9),   # СЗ — лава
        '2': (KX + 8, KY - 9),   # СВ — бездна
        '3': (KX - 8, KY + 4),   # ЮЗ — зеркала
        '4': (KX + 8, KY + 4),   # ЮВ — круги гидры
    }
    for ch, (qx, qy) in quads.items():
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                assert get(qx + dx, qy + dy) in 'fr', ('знак мимо пола', ch, qx + dx, qy + dy)
                put(qx + dx, qy + dy, ch)

    # Кровь и костяные вставки — пятнами у стен камеры и в преддверии.
    rng = m.rng

    def speckle(x0, y0, x1, y1, ch, n, ok='f', gap=3):
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

    # Лужи крови — по две клетки.
    for (x, y) in speckle(18, 16, 45, 42, 'x', 7, gap=6):
        for dx, dy in ((1, 0), (0, 1)):
            if get(x + dx, y + dy) == 'f':
                put(x + dx, y + dy, 'x')
    speckle(20, 48, 43, 62, 'x', 4, gap=6)
    speckle(18, 16, 45, 42, 'k', 9, gap=5)
    speckle(20, 48, 43, 62, 'k', 5, gap=4)

    # --- Стены: всё, что граничит с полом района, — живая плоть.
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

    def face_ok(x, y):
        return get(x, y) == 'W' and get(x, y + 1) in FLOORISH

    def faces(y0, y1, x0=1, x1=W - 2):
        return [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1) if face_ok(x, y)]

    # Реликвии пяти боссов — в северной стене преддверия, по обе стороны
    # клапана, по порядку этажей слева направо; шестая ниша — пустая: она
    # ждёт того, кто дошёл сюда.
    relics = {22: 'A', 24: 'N', 26: 'O', 37: 'U', 39: 'Z', 41: '7'}
    for x, ch in relics.items():
        assert face_ok(x, GATE_Y), ('нет стены под реликвию', ch, x, get(x, GATE_Y), get(x, GATE_Y + 1))
        put(x, GATE_Y, ch)
    for x in (21, 27, 36, 42):
        if face_ok(x, GATE_Y):
            put(x, GATE_Y, 'J')

    # Губы клапана — стены по бокам ворот, со стороны преддверия.
    for x in (29, 34):
        if get(x, GATE_Y) in 'W#':
            put(x, GATE_Y, 'H')

    # Лица стен камеры: вены, рёбра, глаза, полипы по кругу.
    ring = faces(12, 44, 14, 49)
    ring.sort(key=lambda p: math.atan2(p[1] + 0.5 - CY, p[0] + 0.5 - CX))
    for i, (x, y) in enumerate(ring):
        if get(x, y) != 'W':
            continue
        k = i % 7
        if k == 1:
            put(x, y, 'J')
        elif k == 3:
            put(x, y, 'V')
        elif k == 5:
            put(x, y, 'Q')
    # Глаза — четыре на северной дуге (лицо стены видно только над полом).
    for (want_x, want_y) in ((19, 24), (44, 24), (24, 18), (39, 18)):
        best = None
        for (x, y) in ring:
            if get(x, y) not in 'WVQ':
                continue
            d = abs(x - want_x) + abs(y - want_y)
            if best is None or d < best[0]:
                best = (d, x, y)
        assert best and best[0] < 9, ('нет стены под глаз', want_x, want_y, best)
        put(best[1], best[2], 'I')
    # Северная стена камеры над печатью — толстые вены (аорта уходит в породу).
    for x in range(26, 38):
        for y in range(10, 17):
            if face_ok(x, y) and get(x, y) == 'W':
                put(x, y, 'V')

    # Лица стен преддверия и горловины: полипы и вены.
    for i, (x, y) in enumerate(faces(46, 76)):
        if get(x, y) != 'W':
            continue
        if i % 5 == 2:
            put(x, y, 'J')
        elif i % 5 == 4:
            put(x, y, 'V')

    # --- Предметы на полу.
    def floor_obj(x, y, c, ok='f'):
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

    # Восемь рёбер-арок по кругу камеры — у стены, чтобы не мешать бою.
    for i in range(8):
        a = -math.pi / 2 + (i + 0.5) * (2 * math.pi / 8)
        x = int(round(CX - 0.5 + math.cos(a) * (RX - 1.8)))
        y = int(round(CY - 0.5 + math.sin(a) * (RY - 1.8)))
        if y > 40 and abs(x - 31.5) < 5:
            continue
        floor_obj(x, y, 'g', ok='fr')
    # Капель и жерла пара у стен камеры.
    for (x, y) in ((22, 20), (41, 20), (19, 38), (44, 38), (27, 17), (36, 17)):
        floor_obj(x, y, 'd' if (x + y) % 2 else 'e', ok='f')
    # Нервные узлы на венах — светятся.
    for (x, y) in ((KX - 6, KY - 1), (KX + 6, KY - 1), (KX, KY - 8), (KX - 4, KY + 7), (KX + 4, KY + 7)):
        floor_obj(x, y, '6', ok='r')
    # Зубы и кости — у стен.
    for (x, y) in ((20, 27), (43, 27), (24, 40), (39, 40)):
        floor_obj(x, y, 't' if x < 30 else '5', ok='f')

    # Преддверие: сухожилия-столбы, пузыри, капель, узлы.
    for (x, y) in ((24, 52), (39, 52), (23, 58), (40, 58)):
        floor_obj(x, y, 'p', ok='f')
    for (x, y) in ((27, 59), (36, 60), (21, 55), (42, 56), (30, 61)):
        floor_obj(x, y, 's', ok='fx')
    for (x, y) in ((26, 55), (37, 56)):
        floor_obj(x, y, 'd', ok='f')
    floor_obj(31, 52, '6', ok='fk')
    # Горловина: рёбра по краям, пузыри.
    for y in (65, 70):
        floor_obj(JOIN[0], y, 'g', ok='f')
        floor_obj(JOIN[1], y, 'g', ok='f')
    floor_obj(30, 73, 's', ok='f')
    # Жилки: кости, капель; Пазуха — пузыри (бьются, в них добыча).
    floor_obj(15, 64, '5', ok='f')
    floor_obj(48, 61, 'd', ok='f')
    for (x, y) in ((51, 53), (53, 55), (50, 56)):
        floor_obj(x, y, 's', ok='f')
    floor_obj(52, 57, '6', ok='f')
    floor_obj(10, 61, 'k', ok='f')
    # Устье: зубы вокруг лестницы.
    for (x, y) in ((27, 6), (36, 6), (29, 4), (34, 4)):
        floor_obj(x, y, 't', ok='f')

    # Норы-поры: из них ползут сгустки (редко) — в преддверии и горловине.
    def pore(x, y):
        for r in range(0, 5):
            for dx, dy in ((0, 0), (-r, 0), (r, 0), (0, -r), (0, r)):
                xx, yy = x + dx, y + dy
                if get(xx, yy) in 'WV' and any(get(xx + a, yy + b) == 'f' for a, b in ((0, 1), (1, 0), (-1, 0), (0, -1))):
                    put(xx, yy, 'o')
                    return
        raise AssertionError(('нет места под нору', x, y))

    pore(20, 54)
    pore(43, 58)
    pore(27, 67)
    pore(36, 71)

    # Последний ряд — стык: пол ровно в столбцах JOIN, остальное — порода '#'.
    last = ['#'] * W
    for x in range(JOIN[0], JOIN[1] + 1):
        last[x] = 'f'
    rows[H - 1] = last
    # Первый и последний столбцы — порода.
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
    walk = set('.frxmhk1234Fgpsdet56T$,>K')

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
    assert (kx, ky) in seen, 'до сердца не дойти'
    for ch in 'T$':
        for p in find(ch):
            assert p in seen, ('не дойти до', ch, p)
    stairs = find('>')
    sealed = bfs(*start)
    for s in stairs:
        assert s not in sealed, 'лестница мимо печати'
    opened = bfs(*start, seal=True)
    for s in stairs:
        assert s in opened, 'после победы до лестницы не дойти'
    # Арена: заливка от K без ворот и печати.
    arena = bfs(kx, ky, gate=False, grate=False, crack=False)
    assert 40 < len(arena) < 1500, ('площадь арены', len(arena))
    assert not any(y >= GATE_Y for _, y in arena), 'арена протекла за ворота'
    tx, ty = find('T')[0]
    assert math.hypot(tx - kx, ty - ky) < 13.9, ('табличка далеко от сердца', math.hypot(tx - kx, ty - ky))
    last = rows[-1]
    assert [i for i, c in enumerate(last) if c != '#'] == list(range(JOIN[0], JOIN[1] + 1)), 'стык'
    print(f'арена {len(arena)} клеток, табличка в {math.hypot(tx - kx, ty - ky):.1f} от сердца', file=sys.stderr)


def write(rows):
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
    path = os.path.join(root, 'src', 'lib', 'dungeon-floors', 'f15-boss-map.ts')
    head = (
        '// Карта района «Сердце» этажа 15 — собрана скриптом scripts/dungeon/f15_boss.py\n'
        '// (кисти brush.py). Руками не править: запустите скрипт, он перепишет файл.\n'
        '// Нижний ряд — стык с «Миром»: пол ровно в столбцах F15_JOIN (28–35).\n'
    )
    with open(path, 'w') as f:
        f.write(head + '\n' + ts('F15_HEART_MAP', rows))
    print('записано', os.path.relpath(path, root), file=sys.stderr)


if __name__ == '__main__':
    rows = main('--show' in sys.argv)
    for r in rows:
        assert len(r) == W and r[0] == '#' and r[-1] == '#'
    write(rows)
