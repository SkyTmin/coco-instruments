"""Residents of the square: NA character sheets recoloured into the camp (v2.80).

Every NA sheet is 64 × 112: columns down / up / left / right, rows 0–3 walk, 4 attack, 5 jump,
6 special — the same layout as the dungeon hero, so the game draws residents with the same code.
Each resident is a base character plus a recipe: the camp grade and role recolours by hue band
(a village tunic becomes a quilted camp jacket, a red robe a violet one). Faces come with the
sheet (Faceset.png, 38 × 38) and go to the dialogue window.
"""
from __future__ import annotations

from lib import Img, camp, hue_role, na

# id → (NA character, recipe). Recipe: list of ('grade', sat) | ('hue', h0, h1, to_h, sat_k, val_k)
# | ('remap', {from: to}). Ids are what maps and the game use (`chars/<id>.png`, `faces/<id>.png`).
RESIDENTS: dict[str, tuple[str, list]] = {
    # Кузнец: коренастый, борода, кожаный фартук поверх рубахи
    'smith': ('Caveman', [('grade', 0.7)]),
    # Чародей: глубокий капюшон, лица нет, светятся глаза — тёмный ниндзя в фиолетовом
    'mage': ('NinjaDark', [('hue', 60, 200, 272, 1.6, 1.05), ('grade', 0.95)]),
    # Барыга: цилиндр, чёрное пальто
    'trader': ('Noble', [('grade', 0.7)]),
    # Смотрительница питомника
    'keeper': ('Woman', [('grade', 0.7)]),
    # Начальник лагеря
    'chief': ('Inspector', [('grade', 0.7)]),
    # Бригадир шахты: каска и очки
    'foreman': ('EggBoy', [('grade', 0.7)]),
    # Лифтёр подземелья
    'liftman': ('OldMan', [('grade', 0.7)]),
    # Охрана
    'guard': ('CamouflageGreen', [('grade', 0.75)]),
    # Каптёрщик
    'clerk': ('Villager2', [('grade', 0.7)]),
    # Продавщица ларька
    'seller': ('Villager5', [('grade', 0.7)]),
    # Крупье клуба
    'croupier': ('Monk', [('grade', 0.7)]),
    # Дневальный Барака 1 (v2.81): молодой зэк в ватнике цвета шифера
    'orderly': ('Villager3', [('hue', 60, 180, 212, 0.55, 0.9), ('grade', 0.7)]),
}


def _apply(img: Img, recipe: list) -> Img:
    for step in recipe:
        if step[0] == 'grade':
            img = camp(img, sat=step[1])
        elif step[0] == 'hue':
            _, h0, h1, to_h, sk, vk = step
            img = hue_role(img, h0, h1, to_h, sk, vk)
        elif step[0] == 'remap':
            img = img.remap(step[1])
    return img


def sheet(id: str) -> Img:
    base, recipe = RESIDENTS[id]
    return _apply(na(f'Actor/Characters/{base}/SpriteSheet.png'), recipe)


def face(id: str) -> Img:
    base, recipe = RESIDENTS[id]
    return _apply(na(f'Actor/Characters/{base}/Faceset.png'), recipe)


def frame(id: str, col: int = 0, row: int = 0) -> Img:
    return sheet(id).crop(col * 16, row * 16, 16, 16)
