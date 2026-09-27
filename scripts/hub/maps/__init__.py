"""The square and its interiors. One module per map, each with `build() -> Map`.

Order matters only for the build log; doors refer to maps by id.
"""
import importlib

MAPS = ['square', 'forge', 'trader', 'hq', 'club']


def load(id: str):
    return importlib.import_module(f'maps.{id}').build()
