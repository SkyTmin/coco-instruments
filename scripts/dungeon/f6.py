"""Этаж 6 «Огненный разлом» — карта (v2.81, второй заход).

Мотив — глубины с красным драконом: лава и корка остывшей лавы, пепел,
обсидиановые мосты, трещины со светом снизу, базальтовые столбы, кости
крупных зверей и брошенный лагерь искателей приключений (котёл, палатки).

Три района снизу вверх:
  f6       — «Пепельные галереи» (вход, лифт): лагерь искателей у лифта,
             развилка — «Кладбище великанов» (кости, шахта, тайник за
             трещиной) или «Гейзерное поле» (ЗАЛ-СОБЫТИЕ: жерла бьют
             волнами); «Пепельная развилка»; служебный ход с решёткой к
             лифту; галерея базальтовых столбов вверх.
  f6lakes  — «Лавовые озёра»: лифт, большое озеро с обсидиановым мостом
             (ЗАЛ-СОБЫТИЕ: мост рушится за спиной), обход по корке, берег
             с шахтой, поле червей (лавовые омуты и гати), тайник за
             трещиной, террасы наверх, служебный ход с решёткой.
  f6nest   — «Гнездо змея»: лифт, зал извержения (ЗАЛ-СОБЫТИЕ: лава
             поднимается кольцами от краёв), гнездо с яйцами и тайником,
             арена Красного змея, печать и лестница вниз, ход по корке с
             решёткой обратно к лифту.

Запуск: python3 scripts/dungeon/f6.py [--show] — пишет
src/lib/dungeon-floors/f6-map.ts (руками не править). Зерно постоянное.

Свои буквы (легенда — `AreaSpec.legend` в f6.ts):
  _  лава (глубина)                 *  лава, светит
  m  лава с пузырём (живой)         :  корка остывшей лавы (жжёт)
  ;  пепел                          +  копоть
  h  трещина со светом снизу        i  трещина без света
  V  жерло гейзера                  O  обсидиановый мост
  1 2 3  кольца зала извержения     &  пол арены (полированный базальт)
  N  место живой руды               w  стена с магмовой жилой
  I  базальтовая стена (столбчатая)  Z  лавопад на стене
  |  базальтовый столб              r  рёбра великана
  s  череп великана                 k  кости
  t  палатка                        x  лежак и мешок
  q  котёл над огнём                f  костёр
  F  меч в пепле                    A  пепельный нанос
  Q  друза кварца                   J  серебряная жила в камне
  g  жеода (бьётся)                 j  ящик припасов (бьётся)
  e  жаровня                        d  яйцо дракона
  y  скорлупа
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from brush import Map, W, check, show, write_floor  # noqa: E402

# Всё, по чему ходят: базовый пол и свои буквы пола.
FLOORISH = '.,;:+hiVO123&N'
LAVA = '_*m'


def floorish(c):
    return c in FLOORISH


def faces(m, x0, y0, x1, y1):
    """Клетки стены, под которыми пол: лицо стены видно."""
    out = []
    for y in range(max(0, y0), min(m.h - 1, y1 + 1)):
        for x in range(max(1, x0), min(W - 1, x1 + 1)):
            if m.g[y][x] == '#' and m.g[y + 1][x] in '.,' and not m.lock[y][x]:
                out.append((x, y))
    return out


def floor_cells(m, x0, y0, x1, y1, ok='.'):
    return [(x, y) for y in range(max(0, y0), min(m.h, y1 + 1))
            for x in range(max(1, x0), min(W - 1, x1 + 1))
            if m.g[y][x] in ok and not m.lock[y][x]]


def paint(m, x0, y0, x1, y1, ch, share=1.0, ok='.'):
    rng = m.rng
    for (x, y) in floor_cells(m, x0, y0, x1, y1, ok):
        if rng.random() < share:
            m.g[y][x] = ch


def sprinkle(m, cells, ch, share, gap=0, lock=True):
    """Раскидать букву по доле клеток, не ближе `gap` друг к другу."""
    rng = m.rng
    placed = []
    for (x, y) in cells:
        if rng.random() >= share:
            continue
        if any(abs(x - px) + abs(y - py) < gap for px, py in placed):
            continue
        if lock:
            m.put(x, y, ch)
        else:
            m.g[y][x] = ch
        placed.append((x, y))
    return placed


def near(m, x, y, chars, r=1):
    return any(m.get(x + dx, y + dy) in chars
               for dy in range(-r, r + 1) for dx in range(-r, r + 1) if dx or dy)


def lava_ell(m, cx, cy, rx, ry, rough=0.25):
    """Лавовое озеро: овал с неровным краем, лава только по полу."""
    ph = [m.rng.random() * 6.283 for _ in range(4)]
    for y in range(int(cy - ry * 1.4) - 1, int(cy + ry * 1.4) + 2):
        for x in range(int(cx - rx * 1.4) - 1, int(cx + rx * 1.4) + 2):
            if not m.inb(x, y) or m.lock[y][x]:
                continue
            dx = (x + 0.5 - cx) / rx
            dy = (y + 0.5 - cy) / ry
            a = math.atan2(dy, dx)
            k = 1 + rough * (0.55 * math.sin(3 * a + ph[0]) + 0.3 * math.sin(5 * a + ph[1])
                             + 0.2 * math.sin(8 * a + ph[2]) + 0.12 * math.sin(13 * a + ph[3]))
            if dx * dx + dy * dy <= k * k and floorish(m.g[y][x]):
                m.g[y][x] = '_'


def lava_life(m, y0, y1):
    """Часть лавы светит (`*`), в части — пузыри (`m`). Свет — не на
    каждой клетке: сотни источников съели бы кадр."""
    rng = m.rng
    cells = [(x, y) for y in range(y0, y1 + 1) for x in range(1, W - 1) if m.g[y][x] == '_']
    rng.shuffle(cells)
    lit = []
    for (x, y) in cells:
        if any(abs(x - a) + abs(y - b) < 5 for a, b in lit):
            continue
        m.g[y][x] = '*'
        lit.append((x, y))
    cells = [(x, y) for (x, y) in cells if m.g[y][x] == '_']
    bub = []
    for (x, y) in cells:
        if rng.random() > 0.07:
            continue
        if any(abs(x - a) + abs(y - b) < 4 for a, b in bub):
            continue
        # Пузырь — посреди лавы, а не у берега: у берега он читался бы кочкой.
        if near(m, x, y, FLOORISH, 1):
            continue
        m.g[y][x] = 'm'
        bub.append((x, y))


def ash_and_soot(m, y0, y1, ash=0.1, soot=0.05, fissure=0.025):
    """Пепел островками по шуму, копоть и трещины со светом снизу."""
    from brush import noise
    rng = m.rng
    for (x, y) in floor_cells(m, 1, y0, W - 2, y1):
        n = noise(x, y, 5, 61)
        if n > 1 - ash * 3.2 and rng.random() < 0.8:
            m.g[y][x] = ';'
        elif rng.random() < soot:
            m.g[y][x] = '+'
    cells = floor_cells(m, 1, y0, W - 2, y1)
    rng.shuffle(cells)
    lit = []
    for (x, y) in cells:
        if rng.random() > fissure:
            continue
        if any(abs(x - a) + abs(y - b) < 6 for a, b in lit):
            m.g[y][x] = 'i'
        else:
            m.g[y][x] = 'h'
            lit.append((x, y))


def walls_life(m, y0, y1, vein=0.07, basalt=0.2):
    """Лица стен: магмовые жилы (светят) и столбчатый базальт."""
    rng = m.rng
    fs = faces(m, 1, y0, W - 2, y1)
    rng.shuffle(fs)
    sprinkle(m, fs, 'w', vein, gap=5)
    fs = faces(m, 1, y0, W - 2, y1)
    rng.shuffle(fs)
    sprinkle(m, fs, 'I', basalt, gap=0)


def crust_patch(m, cx, cy, rx, ry, share=0.85):
    """Корка остывшей лавы пятном (жжёт)."""
    rng = m.rng
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if not m.inb(x, y) or m.lock[y][x] or m.g[y][x] not in '.;+':
                continue
            dx = (x + 0.5 - cx) / rx
            dy = (y + 0.5 - cy) / ry
            if dx * dx + dy * dy <= 1 and rng.random() < share:
                m.g[y][x] = ':'


def columns(m, x0, y0, x1, y1, n, gap=3):
    """Базальтовые столбы: на полу, не у прохода (два соседа свободны)."""
    rng = m.rng
    cells = floor_cells(m, x0, y0, x1, y1, '.;+')
    rng.shuffle(cells)
    got = []
    for (x, y) in cells:
        if len(got) >= n:
            break
        if any(abs(x - a) + abs(y - b) < gap for a, b in got):
            continue
        # Столб не встаёт вплотную к стене и к лаве: проход не закрываем.
        if near(m, x, y, '#' + LAVA + 'wIZ', 1):
            continue
        m.put(x, y, '|')
        got.append((x, y))
    return got


def force_wall(m, x0, y0, x1, y1):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if m.inb(x, y):
                m.g[y][x] = '#'
                m.lock[y][x] = True


# ---------------------------------------------------------------------------
# Район 1 — «Пепельные галереи» (вход, лифт).
# ---------------------------------------------------------------------------

def area_gallery():
    H = 110
    m = Map(H, seed=6601, cave='.')

    # Проход наверх, в «Лавовые озёра»: столбцы 30…33.
    m.rect(30, 0, 33, 8)

    # --- Верхняя галерея базальтовых столбов: два колена.
    m.ell(24, 12, 12, 6)
    m.ell(38, 25, 12, 6)
    m.ell(31, 18, 6, 3)                     # колено между ними
    m.vpath(31, 29, 41)                     # вниз, к развилке
    # Тупик с тайником на западе верхнего колена.
    m.hpath(5, 13, 11, w=2)
    m.ell(5, 8, 3, 3)
    # --- «Пепельная развилка».
    m.ell(30, 44, 13, 6)
    # --- «Кладбище великанов» (запад).
    m.ell(17, 62, 9, 8)
    m.vpath(17, 46, 56)
    # Ход вниз вдоль западной стены: к шахте и к лагерю.
    m.vpath(7, 66, 99)
    m.hpath(7, 12, 67)
    m.hpath(7, 20, 99)
    m.rect(9, 76, 15, 82)                   # зал кварцевой шахты
    m.rect(8, 78, 9, 80)
    # --- «Гейзерное поле» (восток).
    m.ell(40, 70, 10, 8)
    m.vpath(40, 47, 63)
    m.vpath(37, 77, 93)                     # вниз, к лагерю
    # Карман с тайником у поля (восток).
    m.hpath(49, 53, 70, w=1)
    m.rect(52, 68, 55, 71)
    # --- Лагерь искателей у лифта.
    m.ell(32, 99, 15, 7)
    m.rect(40, 96, 46, 102)
    m.jitter(0.3, 2)

    # Перемычки дрожь не трогает: кладбище, поле, служебный ход — отдельно.
    force_wall(m, 26, 53, 29, 78)
    force_wall(m, 56, 66, 57, 74)
    # --- Служебный ход: от развилки на восток и вниз, к лагерю; решётка
    # открывается только изнутри хода — с востока.
    m.hpath(43, 60, 44)
    m.vpath(59, 44, 99)
    m.hpath(48, 60, 99)
    force_wall(m, 47, 96, 47, 102)
    m.put(47, 99, 'D')

    # --- Тайник кладбища: ниша за треснувшей стеной (запад).
    force_wall(m, 1, 56, 7, 66)
    m.rect(3, 59, 5, 63)
    m.put(6, 61, '%')
    m.rect(7, 60, 8, 62)
    m.protect(1, 55, 8, 67)
    m.put(4, 60, '$')

    # --- Лагерь: лифт, палатки, котёл, костёр, лежаки.
    m.floor(28, 100, 'E')
    m.put(32, 103, 'T')
    m.wall_obj(31, 91, 'b')
    for (x, y, c) in ((40, 95, 't'), (44, 98, 't'), (39, 99, 'q'), (42, 101, 'f'),
                      (37, 103, 'x'), (45, 102, 'x'), (44, 95, 'j'), (46, 100, 'j'),
                      (36, 95, 'F'), (21, 97, 'k'), (19, 102, 'A'), (24, 104, 'e'),
                      # Третья палатка, лежаки, ящики, брошенный меч — лагерь
                      # на полдюжины искателей, а не на одного.
                      (34, 95, 't'), (33, 97, 'x'), (41, 97, 'x'), (30, 95, 'j'),
                      (35, 105, 'j'), (25, 99, 'F'), (27, 104, 'A'), (43, 104, 'k')):
        m.floor(x, y, c)
    m.wall_obj(22, 92, 'L')
    m.wall_obj(38, 92, 'L')

    # --- Шахта: на северной стене зала кварцевой шахты.
    m.wall_obj(12, 75, 'M')
    m.put(10, 82, 'T')
    for (x, y, c) in ((14, 77, 'Q'), (9, 81, 'Q'), (15, 81, 'J'), (13, 80, 'N'), (10, 77, 'N')):
        m.floor(x, y, c)

    # --- Кладбище великанов: рёбра дугой, череп, кости.
    for (x, y) in ((12, 59), (14, 58), (16, 58), (18, 58), (20, 59)):
        m.floor(x, y, 'r')
    m.floor(22, 64, 's')
    for (x, y, c) in ((11, 66, 'k'), (19, 67, 'k'), (24, 60, 'k'), (15, 63, 'A'), (21, 68, 'F'),
                      (10, 63, 'g'), (13, 68, 'N')):
        m.floor(x, y, c)
    m.put(17, 57, 'R')
    # Лавовый ручей из-под стены кладбища — к середине, не насквозь.
    for y in range(64, 71):
        for x in (23, 24):
            if m.g[y][x] == '.':
                m.g[y][x] = '_'

    # --- Гейзерное поле: жерла сеткой, трещины, корка.
    vents = []
    for y in range(64, 77):
        for x in range(32, 49):
            if m.g[y][x] != '.':
                continue
            if (x + 2 * y) % 4 == 0 and y % 2 == 0:
                if not near(m, x, y, '#', 1):
                    m.put(x, y, 'V')
                    vents.append((x, y))
    m.put(54, 69, '$')
    m.floor(53, 71, 'k')
    m.floor(40, 68, 'T')

    # --- Развилка: указатель, жаровни, засада на подходе с севера.
    m.put(30, 46, 'T')
    m.floor(24, 42, 'e')
    m.floor(37, 42, 'e')
    m.put(31, 36, 'a')

    # --- Верхняя галерея: тайник в тупике, стая, лавовый омут, лавопад.
    m.put(4, 8, '$')
    m.floor(6, 10, 'k')
    lava_ell(m, 45, 24, 3.2, 2.2, rough=0.2)
    lava_ell(m, 18, 14, 2.4, 1.6, rough=0.2)
    m.put(34, 24, 'R')
    m.put(20, 9, 'a')

    # --- Норы: трещины в стенах, пол рядом.
    for (x, y) in ((13, 5), (35, 18), (49, 28), (19, 37), (42, 38), (7, 58), (26, 70),
                   (30, 66), (49, 75), (8, 88), (59, 60), (59, 84), (14, 99)):
        m.burrow(x, y)

    # --- Своё: столбы, пепел, корка, жилы, лавопад.
    columns(m, 13, 5, 49, 31, 9, gap=4)
    columns(m, 18, 38, 42, 50, 3, gap=5)
    columns(m, 9, 55, 25, 70, 2, gap=5)
    crust_patch(m, 27, 25, 3, 2)
    crust_patch(m, 52, 60, 2, 6, share=0.5)
    crust_patch(m, 59, 30, 2, 8, share=0.45)
    walls_life(m, 0, 88)
    ash_and_soot(m, 0, 91, ash=0.13, soot=0.05)
    ash_and_soot(m, 92, H - 1, ash=0.05, soot=0.02, fissure=0.0)
    lf = sorted(faces(m, 36, 18, 50, 22))
    if lf:
        m.put(*lf[len(lf) // 2], 'Z')
    lf = sorted(faces(m, 14, 5, 26, 8))
    if lf:
        m.put(*lf[len(lf) // 3], 'Z')
    # Лагерь у лифта — без жил и лавы: там тихо.
    for y in range(90, H):
        for x in range(W):
            if m.g[y][x] in 'wZ':
                m.g[y][x] = 'I'
    lava_life(m, 0, H - 1)
    print(f'  f6: жерл {len(vents)}', file=sys.stderr)
    return m


# ---------------------------------------------------------------------------
# Район 2 — «Лавовые озёра».
# ---------------------------------------------------------------------------

def area_lakes():
    H = 104
    m = Map(H, seed=6607, cave='.')

    # Вход снизу: столбцы 30…33 — продолжение хода первого района.
    m.rect(30, 96, 33, H - 1)
    # --- Площадка входа и ниша лифта.
    m.ell(31, 93, 10, 5)
    m.vpath(31, 84, 90)
    m.rect(9, 90, 17, 97)
    m.hpath(16, 23, 94)
    # --- Большое озеро: пещера, в ней лава от стены до стены.
    m.ell(32, 74, 23, 12)
    # --- Северный берег и зал шахты.
    m.ell(32, 57, 21, 6)
    # --- Поле червей: пещера с омутами.
    m.ell(31, 37, 24, 13)
    # --- Террасы наверх.
    m.ell(29, 13, 15, 8)
    m.vpath(30, 18, 27)
    m.rect(28, 0, 31, 6)
    # --- Обход озера по корке: вдоль западной стены.
    m.vpath(3, 57, 92)
    m.hpath(3, 12, 91)
    m.hpath(3, 14, 58)
    m.jitter(0.28, 2)
    force_wall(m, 5, 60, 7, 88)
    force_wall(m, 56, 8, 57, 96)

    # --- Служебный ход: от террас на восток и вниз, к площадке входа.
    m.hpath(44, 60, 13)
    m.vpath(59, 13, 93)
    m.hpath(43, 60, 93)
    force_wall(m, 42, 90, 42, 97)
    m.rect(38, 92, 41, 94)
    m.put(42, 93, 'D')

    # --- Озеро: лава поперёк всей пещеры, берега — на юге и севере.
    for y in range(64, 85):
        for x in range(1, W - 1):
            if m.g[y][x] == '.' and 9 <= x <= 55:
                m.g[y][x] = '_'
    lava_ell(m, 32, 74, 22, 9)
    # Островок с тайником — к нему ветка моста в одну клетку.
    m.ell(45, 77, 3, 2, c='.', natural=False, rough=0.1)
    m.ell(18, 70, 3, 2, c='.', natural=False, rough=0.1)
    # Мост: с южного берега на северный (x 31…32).
    for y in range(62, 88):
        for x in (31, 32):
            if m.g[y][x] in LAVA or m.g[y][x] == '.':
                m.g[y][x] = 'O'
    for x in range(33, 43):
        if m.g[77][x] in LAVA:
            m.g[77][x] = 'O'
    m.put(46, 77, '$')
    m.floor(44, 78, 'g')
    # Островок у запада: гнездо саламандр (стая) — видно с моста.
    m.put(18, 70, 'R')
    m.floor(17, 71, 'k')

    # --- Лифт и площадка.
    m.floor(13, 93, 'E')
    m.put(20, 93, 'T')
    m.wall_obj(31, 88, 'b')
    for (x, y, c) in ((25, 96, 'j'), (36, 96, 'e'), (26, 90, 'e'), (10, 96, 'j'), (16, 91, 'k')):
        m.floor(x, y, c)

    # --- Северный берег: шахта, столбы, указатель.
    m.wall_obj(44, 51, 'M')
    m.put(40, 58, 'T')
    for (x, y, c) in ((47, 53, 'J'), (42, 53, 'Q'), (48, 56, 'N'), (38, 54, 'N'), (22, 55, 'e')):
        m.floor(x, y, c)
    columns(m, 14, 52, 50, 62, 6, gap=5)

    # --- Поле червей: омуты и гати между ними.
    pools = [(15, 32, 4, 3), (27, 29, 3.5, 2.5), (40, 31, 5, 3), (20, 42, 4, 3), (33, 40, 3, 2.5),
             (45, 42, 4, 3.5), (12, 45, 2.5, 2)]
    for (cx, cy, rx, ry) in pools:
        lava_ell(m, cx, cy, rx, ry, rough=0.3)
    # Тайник за трещиной в западной стене поля.
    force_wall(m, 1, 30, 6, 40)
    m.rect(2, 33, 4, 37)
    m.put(5, 35, '%')
    m.rect(6, 34, 7, 36)
    m.protect(1, 29, 7, 41)
    m.put(3, 34, '$')
    m.floor(3, 36, 'k')
    m.put(30, 45, 'R')
    m.put(24, 35, 'a')

    # --- Террасы: корка, стая, засада, лавопады.
    crust_patch(m, 22, 12, 5, 3, share=0.75)
    crust_patch(m, 38, 9, 4, 2, share=0.7)
    lava_ell(m, 21, 16, 3, 1.6, rough=0.2)
    m.put(34, 12, 'R')
    m.put(29, 4, 'a')
    columns(m, 15, 6, 44, 20, 5, gap=4)

    # --- Обход: корка по всему пути, пепел, кости смельчаков.
    for y in range(58, 92):
        for x in range(2, 5):
            if m.g[y][x] == '.' and m.rng.random() < 0.55:
                m.g[y][x] = ':'
    m.floor(3, 75, 'F')
    m.floor(3, 83, 'k')

    for (x, y) in ((3, 66), (14, 51), (50, 55), (9, 28), (54, 36), (36, 25), (18, 6),
                   (44, 8), (59, 50), (59, 75), (26, 88)):
        m.burrow(x, y)

    walls_life(m, 0, H - 1, vein=0.1, basalt=0.18)
    ash_and_soot(m, 0, H - 1, ash=0.08, soot=0.06, fissure=0.03)
    for (x0, y0, x1, y1) in ((14, 60, 50, 64), (20, 22, 44, 26)):
        lf = sorted(faces(m, x0, y0, x1, y1))
        for k, (x, y) in enumerate(lf):
            if k % 9 == 4:
                m.put(x, y, 'Z')
    lava_life(m, 0, H - 1)
    return m


# ---------------------------------------------------------------------------
# Район 3 — «Гнездо змея» (арена, печать, лестница).
# ---------------------------------------------------------------------------

def area_nest():
    H = 96
    m = Map(H, seed=6613, cave='.')

    m.rect(28, 88, 31, H - 1)
    # --- Зал входа и ниша лифта.
    m.ell(30, 86, 10, 4)
    m.rect(7, 82, 15, 89)
    m.hpath(14, 22, 86)
    # --- Зал извержения: круг радиуса 11.
    cx, cy, R = 30, 66, 11
    for y in range(cy - R - 1, cy + R + 2):
        for x in range(cx - R - 1, cx + R + 2):
            if (x + 0.5 - cx - 0.5) ** 2 + (y - cy) ** 2 <= R * R + 1:
                m.set(x, y, '.')
    m.vpath(30, 76, 83)
    m.vpath(30, 48, 56)
    # --- Гнездо (преддверие арены).
    m.ell(30, 42, 16, 6)
    # --- Арена: овал 13×10 вокруг (30, 16).
    ax, ay = 30, 16
    for y in range(ay - 11, ay + 12):
        for x in range(ax - 14, ax + 15):
            if ((x - ax) / 13.2) ** 2 + ((y - ay) / 10.2) ** 2 <= 1:
                m.set(x, y, '&')
    m.jitter(0.25, 2)
    # Стены вокруг арены — ровные: выход только через ворота.
    for y in range(ay - 12, ay + 13):
        for x in range(ax - 16, ax + 17):
            if not m.inb(x, y):
                continue
            inside = ((x - ax) / 13.2) ** 2 + ((y - ay) / 10.2) ** 2 <= 1
            if not inside:
                m.g[y][x] = '#'
                m.lock[y][x] = True
    # Ворота на юге и коридор к гнезду.
    gy = ay + 11
    for x in range(ax - 1, ax + 2):
        m.put(x, gy, 'G')
        m.put(x, gy - 1, '&')
    m.rect(ax - 3, gy + 1, ax + 3, gy + 9)
    m.put(28, gy + 1, 'T')
    m.put(ax, ay - 1, 'K')
    # Лавовые омуты по краям арены и лавопады на северной стене.
    for (px, py) in ((20, 11), (40, 11), (21, 21), (39, 21)):
        lava_ell(m, px, py, 2.2, 1.6, rough=0.15)
    north = [(x, y) for y in range(ay - 12, ay) for x in range(ax - 14, ax + 15)
             if m.g[y][x] == '#' and m.g[y + 1][x] == '&']
    north.sort(key=lambda p: math.atan2(p[1] - ay, p[0] - ax))
    for k in (len(north) // 5, len(north) // 2, len(north) * 4 // 5):
        m.put(*north[k], 'Z')

    # Посередине — застывший «глаз» с трещиной и жаровни на краю площадки.
    m.put(30, 66, 'h')
    for (x, y) in ((28, 63), (32, 63), (28, 69), (32, 69)):
        m.put(x, y, 'e')
    # --- Кольца зала извержения: лава поднимается от краёв.
    for y in range(cy - R - 1, cy + R + 2):
        for x in range(cx - R - 1, cx + R + 2):
            if m.g[y][x] != '.':
                continue
            d = math.hypot(x - cx, y - cy)
            if d > 8.4:
                m.g[y][x] = '1'
            elif d > 6.2:
                m.g[y][x] = '2'
            elif d > 4.2:
                m.g[y][x] = '3'
    # Посередине — застывший «глаз» с трещинами и жаровни у колец.

    # --- Лифт гнезда.
    m.floor(11, 85, 'E')
    m.put(17, 87, 'T')
    for (x, y, c) in ((8, 83, 'j'), (14, 83, 'e'), (36, 88, 'e'), (26, 88, 'k')):
        m.floor(x, y, c)

    # --- Ход по корке: из гнезда на восток и вниз, к залу входа; решётка
    # открывается только изнутри хода — с востока.
    m.hpath(45, 52, 42)
    m.vpath(51, 42, 87)
    m.hpath(42, 52, 86)
    force_wall(m, 41, 84, 41, 88)
    m.rect(38, 85, 40, 87)
    m.put(41, 86, 'D')
    force_wall(m, 42, 50, 49, 80)

    # --- Гнездо: яйца, скорлупа, кости, жаровни, тайник за трещиной.
    for (x, y, c) in ((22, 40, 'd'), (38, 40, 'd'), (36, 45, 'd'), (21, 44, 'y'), (39, 43, 'y'),
                      (26, 46, 'k'), (34, 38, 'k'), (18, 42, 'e'), (42, 42, 'e'), (25, 38, 's'),
                      (33, 46, 'A'), (16, 44, 'g')):
        m.floor(x, y, c)
    # Ниша за трещиной: над восточным краем гнезда.
    m.put(34, 41, 'R')
    m.put(24, 84, 'a')
    force_wall(m, 42, 30, 48, 36)
    m.rect(43, 32, 46, 34)
    m.put(44, 35, '%')
    m.rect(43, 36, 45, 38)
    m.protect(41, 29, 49, 36)
    m.put(45, 33, '$')

    # --- Печать и лестница: с запада гнезда на север.
    m.hpath(4, 15, 42)
    for y in range(41, 44):
        m.put(10, y, 'S')
    m.vpath(4, 5, 42)
    m.rect(2, 2, 12, 9)
    m.put(7, 5, '>')
    m.floor(3, 8, 'k')
    m.floor(11, 3, 'e')
    force_wall(m, 13, 2, 16, 30)

    # Норы — у входа и в гнезде (в арене и в зале извержения — нет).
    for (x, y) in ((22, 81), (38, 82), (15, 37), (44, 47), (51, 60), (6, 30)):
        m.burrow(x, y)
    for y in range(43, 86):
        for x in range(50, 53):
            if m.g[y][x] == '.' and m.rng.random() < 0.5:
                m.g[y][x] = ':'

    ash_and_soot(m, 29, H - 1, ash=0.06, soot=0.1, fissure=0.035)
    # Арена: трещины со светом и копоть по полу.
    for (x, y) in floor_cells(m, 16, 5, 44, 27, '&'):
        if m.rng.random() < 0.035 and not near(m, x, y, 'hK', 3):
            m.g[y][x] = 'h'
    walls_life(m, 29, H - 1, vein=0.12, basalt=0.15)
    lava_life(m, 0, H - 1)
    print('  f6nest: арена', sum(r.count('&') for r in m.g[:30]), 'клеток пола', file=sys.stderr)
    return m


if __name__ == '__main__':
    a = area_gallery()
    b = area_lakes()
    c = area_nest()
    ra = check(a, 'f6')
    rb = check(b, 'f6lakes')
    rc = check(c, 'f6nest')
    if '--show' in sys.argv:
        show(rc, 'C')
        show(rb, 'B')
        show(ra, 'A')
    write_floor(6, {'MAP_F6_GALLERY': ra, 'MAP_F6_LAKES': rb, 'MAP_F6_NEST': rc},
                note='Район 1 — «Пепельные галереи» (вход), 2 — «Лавовые озёра», '
                     '3 — «Гнездо змея» (арена).')
