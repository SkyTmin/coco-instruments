"""The square and its interiors. One module per map, each with `build() -> Map`.

Order matters only for the build log; doors refer to maps by id. A module may build a map
with another id: `barrack` builds `barrack1` (the facade's id, the square's door leads there).
"""
import importlib

MAPS = ['square', 'forge', 'mine', 'zone', 'lift', 'tower', 'kennel', 'store', 'kiosk', 'trader', 'hq', 'club', 'barrack']


def load(id: str):
    return importlib.import_module(f'maps.{id}').build()
