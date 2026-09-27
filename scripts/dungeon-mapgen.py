"""Прежний генератор карт подземелья (до v2.81).

С v2.81 карты первого этажа рисует `scripts/dungeon/f1.py` на кистях
`scripts/dungeon/brush.py` и пишет в `src/lib/dungeon-floors/f1-map.ts`.
Этот файл оставлен, чтобы старые ссылки вели туда же:

    python3 scripts/dungeon-mapgen.py --write   # то же, что f1.py --write
    python3 scripts/dungeon-mapgen.py           # напечатать карты с номерами рядов
"""
import os
import runpy
import sys

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    sys.argv[0] = os.path.join(here, 'dungeon', 'f1.py')
    runpy.run_path(sys.argv[0], run_name='__main__')
