"""The prison square (v2.80) — TEMPORARY STUB so doors resolve while the real square is drawn.

The real square (64 × 56, perimeter, towers, every facade, paths) replaces this file. Contract it
must keep: spawn '<building id>' in front of every building's door (facing down, one tile south of
it), a door {to: '<building id>', at: 'in'} on every enterable facade, spawn 'kpp' at the gate,
a door {to: '@back', kind: 'exit'} at the gate, mark 'board' + door {to: '@board', kind: 'use'} at
the notice board.
"""
from __future__ import annotations

from kit import P, crate, floor_tile, ink, text
from lib import T, Img, Map


def build() -> Map:
    m = Map('square', 24, 20, 'outdoor', name='Площадь', ambient=1.0, music='yard', bg='#6e5a44')
    m.fill_tiles(lambda x, y: floor_tile('dirt', x, y, 2))
    # placeholder forge facade: a brick box with a door
    f = Img.new(5 * T, 4 * T, P['brick'][2])
    f.rect_(0, 0, 5 * T, T, P['slate'][2])
    f.rect_(2 * T, 2 * T, T, 2 * T, '#1a1212')
    f.paste_(text('КУЗНИЦА', '#f2c46a'), 12, T + 6)
    m.put('stub.forge', ink(f), 4 * T, 3 * T, solid=(4, 4, 9, 7))
    m.door(6, 6.4, 1, 0.6, 'forge', 'in', kind='enter', label='Кузница')
    m.spawn('forge', 6.5, 7.8, 0)
    m.spawn('kpp', 12, 17, 1)
    m.door(11, 19.4, 2, 0.6, '@back', '', kind='exit', label='Выход')
    m.put('kit.crate', crate(), 14 * T, 8 * T, solid=(14, 8.5, 15, 9))
    m.block(0, 0, 24, 1); m.block(0, 0, 1, 20); m.block(23, 0, 24, 20); m.block(0, 19, 11, 20); m.block(13, 19, 24, 20)
    return m
