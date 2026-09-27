"""Core of the prison-square pipeline (v2.80): images, the camp palette, pixel drawing, maps.

Everything the square and its interiors are made of passes through here, so the Ninja Adventure
and Kenney pieces and our own drawings end up in one hand:

  * `Img` — an RGBA numpy image with the few operations the maps need (crop, paste, flip, tint).
  * `camp()` — the camp grade: one desaturation and warm/cool split for every source picture, so
    orange village wood and Kenney's clean city end up in the same dusty palette.
  * `outline()` — a 1 px dark contour for sprites that come without one (Kenney), as NA draws it.
  * `grid()` — pixel art from letter rows, the way `Px.map` does it in the game.
  * `Map` — a map in the making: ground picture, half-tile collision, sorted objects, residents,
    doors, lights, effects, spawn points. `build.py` turns a list of maps into the game's files.

Units: 1 tile = 16 px. Map sizes are in tiles, object positions in pixels (top-left of the sprite),
`base` is the pixel row where the object touches the ground (depth sorting), collision is kept on a
half-tile grid (8 px cells), so a barrel can block half a tile.
"""
from __future__ import annotations

import colorsys
import hashlib
import math
import os
import random
from dataclasses import dataclass, field
from typing import Callable, Iterable

import numpy as np
from PIL import Image

T = 16
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(HERE, '.src')
NA = os.path.join(SRC, 'na', 'Assets')
KEN = os.path.join(SRC, 'kenney', 'fantasy')


# ----------------------------------------------------------------------------------------- images
def hexrgb(h: str) -> tuple[int, int, int, int]:
    h = h.lstrip('#')
    if len(h) == 6:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255
    if len(h) == 8:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16)
    raise ValueError(h)


class Img:
    """RGBA uint8 image, H×W×4. Small and explicit: every op returns a new image unless named `_`."""

    __slots__ = ('a',)

    def __init__(self, a: np.ndarray):
        assert a.ndim == 3 and a.shape[2] == 4, a.shape
        self.a = a.astype(np.uint8, copy=False)

    # construction
    @staticmethod
    def new(w: int, h: int, color: str | None = None) -> 'Img':
        a = np.zeros((h, w, 4), np.uint8)
        if color:
            a[:, :] = hexrgb(color)
        return Img(a)

    @staticmethod
    def open(path: str) -> 'Img':
        return Img(np.asarray(Image.open(path).convert('RGBA')).copy())

    def pil(self) -> Image.Image:
        return Image.fromarray(self.a, 'RGBA')

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.pil().save(path, optimize=True)

    @property
    def w(self) -> int:
        return self.a.shape[1]

    @property
    def h(self) -> int:
        return self.a.shape[0]

    def copy(self) -> 'Img':
        return Img(self.a.copy())

    # geometry
    def crop(self, x: int, y: int, w: int, h: int) -> 'Img':
        out = np.zeros((h, w, 4), np.uint8)
        x0, y0, x1, y1 = max(0, x), max(0, y), min(self.w, x + w), min(self.h, y + h)
        if x1 > x0 and y1 > y0:
            out[y0 - y:y1 - y, x0 - x:x1 - x] = self.a[y0:y1, x0:x1]
        return Img(out)

    def flip(self) -> 'Img':
        return Img(self.a[:, ::-1].copy())

    def flipv(self) -> 'Img':
        return Img(self.a[::-1].copy())

    def rot90(self, k: int = 1) -> 'Img':
        return Img(np.rot90(self.a, k).copy())

    def scale(self, k: int) -> 'Img':
        return Img(self.a.repeat(k, 0).repeat(k, 1))

    def bbox(self) -> tuple[int, int, int, int] | None:
        ys, xs = np.nonzero(self.a[:, :, 3])
        if not len(xs):
            return None
        return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1

    def trim(self) -> tuple['Img', int, int]:
        b = self.bbox()
        if not b:
            return Img.new(1, 1), 0, 0
        x0, y0, x1, y1 = b
        return self.crop(x0, y0, x1 - x0, y1 - y0), x0, y0

    # compositing
    def paste_(self, src: 'Img', x: int, y: int, alpha: float = 1.0) -> 'Img':
        """Alpha-over src onto self at (x, y), in place. Returns self."""
        x, y = int(round(x)), int(round(y))
        sx0, sy0 = max(0, -x), max(0, -y)
        dx0, dy0 = max(0, x), max(0, y)
        w = min(src.w - sx0, self.w - dx0)
        h = min(src.h - sy0, self.h - dy0)
        if w <= 0 or h <= 0:
            return self
        s = src.a[sy0:sy0 + h, sx0:sx0 + w].astype(np.float32)
        d = self.a[dy0:dy0 + h, dx0:dx0 + w].astype(np.float32)
        sa = s[:, :, 3:4] / 255.0 * alpha
        da = d[:, :, 3:4] / 255.0
        oa = sa + da * (1 - sa)
        rgb = (s[:, :, :3] * sa + d[:, :, :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
        out = np.concatenate([rgb, oa * 255.0], 2)
        self.a[dy0:dy0 + h, dx0:dx0 + w] = np.clip(out + 0.5, 0, 255).astype(np.uint8)
        return self

    def rect_(self, x: int, y: int, w: int, h: int, color: str, alpha: float = 1.0) -> 'Img':
        c = Img.new(max(1, w), max(1, h), color)
        return self.paste_(c, x, y, alpha)

    def px_(self, x: int, y: int, color: str, alpha: float = 1.0) -> 'Img':
        if 0 <= x < self.w and 0 <= y < self.h:
            if alpha >= 1:
                self.a[y, x] = hexrgb(color)
            else:
                self.rect_(x, y, 1, 1, color, alpha)
        return self

    def line_(self, x0: int, y0: int, x1: int, y1: int, color: str, alpha: float = 1.0) -> 'Img':
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(n + 1):
            t = i / n
            self.px_(int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t)), color, alpha)
        return self

    def ellipse_(self, cx: float, cy: float, rx: float, ry: float, color: str, alpha: float = 1.0) -> 'Img':
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                if ((x + 0.5 - cx) / max(rx, 0.01)) ** 2 + ((y + 0.5 - cy) / max(ry, 0.01)) ** 2 <= 1:
                    self.px_(x, y, color, alpha)
        return self

    def poly_(self, pts: list[tuple[float, float]], color: str, alpha: float = 1.0) -> 'Img':
        """Fill a polygon (pixel centres inside, even-odd), in place."""
        if len(pts) < 3:
            return self
        ys = [p[1] for p in pts]
        for y in range(max(0, int(math.floor(min(ys)))), min(self.h, int(math.ceil(max(ys))) + 1)):
            cy = y + 0.5
            xs = []
            for i in range(len(pts)):
                (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
                if (y0 <= cy < y1) or (y1 <= cy < y0):
                    xs.append(x0 + (cy - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for a, b in zip(xs[0::2], xs[1::2]):
                xa, xb = int(math.ceil(a - 0.5)), int(math.floor(b - 0.5))
                if xb >= xa:
                    self.rect_(xa, y, xb - xa + 1, 1, color, alpha)
        return self

    # colour
    def mask(self) -> np.ndarray:
        return self.a[:, :, 3] > 0

    def tint(self, color: str, k: float) -> 'Img':
        """Mix every opaque pixel toward color by k (keeps alpha)."""
        a = self.a.astype(np.float32)
        c = np.array(hexrgb(color)[:3], np.float32)
        a[:, :, :3] = a[:, :, :3] * (1 - k) + c * k
        return Img(np.clip(a + 0.5, 0, 255).astype(np.uint8))

    def mul(self, k: float) -> 'Img':
        a = self.a.astype(np.float32)
        a[:, :, :3] *= k
        return Img(np.clip(a + 0.5, 0, 255).astype(np.uint8))

    def opacity(self, k: float) -> 'Img':
        a = self.a.copy()
        a[:, :, 3] = (a[:, :, 3].astype(np.float32) * k).astype(np.uint8)
        return Img(a)

    def silhouette(self, color: str) -> 'Img':
        a = self.a.copy()
        r, g, b, _ = hexrgb(color)
        a[:, :, 0], a[:, :, 1], a[:, :, 2] = r, g, b
        return Img(a)

    def remap(self, table: dict[str, str]) -> 'Img':
        """Exact colour swap (the same trick as `recolor` for the dungeon hero)."""
        a = self.a.copy()
        src = self.a[:, :, :3]
        for f, t in table.items():
            fr = np.array(hexrgb(f)[:3], np.uint8)
            hit = np.all(src == fr, axis=2)
            tr = hexrgb(t)
            a[hit, 0], a[hit, 1], a[hit, 2] = tr[0], tr[1], tr[2]
        return Img(a)

    def colors(self) -> tuple[list[str], list[int]]:
        """Distinct opaque colours and their counts, most frequent first (for remap tables)."""
        m = self.a[:, :, 3] > 0
        px = self.a[m][:, :3]
        if not len(px):
            return [], []
        u, c = np.unique(px, axis=0, return_counts=True)
        order = np.argsort(-c)
        return ['#%02x%02x%02x' % tuple(u[i]) for i in order], [int(c[i]) for i in order]


# --------------------------------------------------------------------------------- source sheets
_cache: dict[str, Img] = {}


def na(rel: str) -> Img:
    """A Ninja Adventure sheet by its path under Assets/ (cached)."""
    key = 'na:' + rel
    if key not in _cache:
        _cache[key] = Img.open(os.path.join(NA, rel))
    return _cache[key]


def kenney(rel: str, pitch: int = 17) -> Img:
    """A Kenney sheet by its path under fantasy/, repacked from its 1 px spacing to a plain 16 px grid."""
    key = f'ken:{rel}:{pitch}'
    if key not in _cache:
        im = Img.open(os.path.join(KEN, rel))
        if pitch == T:
            _cache[key] = im
        else:
            cols, rows = (im.w + 1) // pitch, (im.h + 1) // pitch
            out = Img.new(cols * T, rows * T)
            for r in range(rows):
                for c in range(cols):
                    out.a[r * T:(r + 1) * T, c * T:(c + 1) * T] = im.a[r * pitch:r * pitch + T, c * pitch:c * pitch + T]
            _cache[key] = out
    return _cache[key]


def tiles(sheet: Img, tx: int, ty: int, tw: int = 1, th: int = 1) -> Img:
    """A block of whole tiles from a 16 px sheet."""
    return sheet.crop(tx * T, ty * T, tw * T, th * T)


# ----------------------------------------------------------------------------- the camp palette
# Every source picture goes through `camp()`: saturation down to ~55 %, lights a touch warm and
# shadows a touch cool — the dusty northern-camp mood. Accents (fire, glow, gems, paint, neon) are
# painted after the grade or passed with keep=True, so they stay the only saturated things in view.
CAMP_SAT = 0.55


def camp(img: Img, sat: float = CAMP_SAT, warm: float = 0.04, keep: bool = False) -> Img:
    if keep:
        return img
    a = img.a.astype(np.float32) / 255.0
    rgb = a[:, :, :3]
    luma = (rgb * np.array([0.299, 0.587, 0.114], np.float32)).sum(2, keepdims=True)
    out = luma + (rgb - luma) * sat
    # split toning: lights warm, darks cool
    k = np.clip((luma - 0.5) * 2, -1, 1)
    out = out + k * np.array([warm, warm * 0.4, -warm], np.float32) * 0.5 \
              + np.minimum(k, 0) * np.array([warm, 0, -warm * 1.2], np.float32) * 0.5
    a[:, :, :3] = np.clip(out, 0, 1)
    return Img(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8))


def hue_role(img: Img, h0: float, h1: float, to_h: float | None = None, sat_k: float = 1.0,
             val_k: float = 1.0, to_s: float | None = None, min_s: float = 0.08) -> Img:
    """Recolour one role by hue band (degrees, wraps): orange roof → grey slate, and so on.
    Pixels whose hue is in [h0, h1] and saturation ≥ min_s get hue to_h (if given), saturation × sat_k
    (or = to_s), value × val_k. Lightness order inside the role is kept, so the shading survives."""
    a = img.a.copy()
    rgb = a[:, :, :3].astype(np.float32) / 255.0
    mx, mn = rgb.max(2), rgb.min(2)
    v = mx
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    d = np.maximum(mx - mn, 1e-6)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    h = np.where(mx == r, (g - b) / d % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    h = np.where(mx - mn < 1e-6, 0, h)
    inb = (h >= h0) & (h <= h1) if h0 <= h1 else ((h >= h0) | (h <= h1))
    sel = inb & (s >= min_s) & (a[:, :, 3] > 0)
    nh = np.where(sel, to_h if to_h is not None else h, h) / 60.0
    ns = np.where(sel, np.clip((to_s if to_s is not None else s * sat_k), 0, 1), s)
    nv = np.where(sel, np.clip(v * val_k, 0, 1), v)
    i = np.floor(nh).astype(int) % 6
    f = nh - np.floor(nh)
    p, q, t = nv * (1 - ns), nv * (1 - ns * f), nv * (1 - ns * (1 - f))
    rr = np.choose(i, [nv, q, p, p, t, nv])
    gg = np.choose(i, [t, nv, nv, q, p, p])
    bb = np.choose(i, [p, p, t, nv, nv, q])
    out = np.stack([rr, gg, bb], 2)
    a[:, :, :3] = np.where(sel[:, :, None], np.clip(out * 255 + 0.5, 0, 255), a[:, :, :3]).astype(np.uint8)
    return Img(a)


def outline(img: Img, color: str | None = None, diagonal: bool = False, k: float = 0.32) -> Img:
    """Grow a 1 px contour around the opaque shape. color=None: each contour pixel takes the colour
    of the neighbour it borders, darkened to k (NA's contour is a deep shade of the object, not black)."""
    a = img.a
    pad = Img.new(img.w + 2, img.h + 2)
    pad.paste_(img, 1, 1)
    m = pad.a[:, :, 3] > 40
    grow = np.zeros_like(m)
    src = np.zeros(pad.a.shape[:2] + (3,), np.float32)
    cnt = np.zeros(pad.a.shape[:2], np.float32)
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)] + ([(1, 1), (1, -1), (-1, 1), (-1, -1)] if diagonal else [])
    for dx, dy in dirs:
        sh = np.roll(np.roll(m, dy, 0), dx, 1)
        col = np.roll(np.roll(pad.a[:, :, :3].astype(np.float32), dy, 0), dx, 1)
        add = sh & ~m
        grow |= add
        src[add] += col[add]
        cnt[add] += 1
    out = pad.a.copy()
    if color:
        c = hexrgb(color)
        out[grow] = c
    else:
        avg = src / np.maximum(cnt, 1)[:, :, None]
        dark = np.clip(avg * k + np.array([14, 8, 16]) * (1 - k) * 0.5, 0, 255)
        out[grow, :3] = dark[grow].astype(np.uint8)
        out[grow, 3] = 255
    return Img(out)


# ------------------------------------------------------------------------------ pixel drawing
def grid(rows: list[str] | str, pal: dict[str, str]) -> Img:
    """Pixel art from letter rows. '.' and ' ' are transparent; every other letter looks up pal."""
    if isinstance(rows, str):
        rows = [r for r in rows.strip('\n').split('\n')]
    rows = [r.rstrip() for r in rows]
    w = max(len(r) for r in rows)
    out = Img.new(w, len(rows))
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch in '. ':
                continue
            out.a[y, x] = hexrgb(pal[ch])
    return out


def ramp(base: str, n: int = 4, spread: float = 0.34) -> list[str]:
    """n shades of one material, dark → light, with a hue shift (darks cooler, lights warmer) —
    the classic pixel-art ramp, so hand-made materials shade like NA's."""
    r, g, b, _ = hexrgb(base)
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    out = []
    for i in range(n):
        t = (i / (n - 1)) * 2 - 1 if n > 1 else 0
        hh = (h + (-0.03 * t if h < 0.5 else 0.03 * t)) % 1.0
        ll = min(0.95, max(0.05, l + t * spread * 0.5))
        ss = min(1, max(0, s * (1 - 0.25 * abs(t))))
        rr, gg, bb = colorsys.hls_to_rgb(hh, ll, ss)
        out.append('#%02x%02x%02x' % (int(rr * 255), int(gg * 255), int(bb * 255)))
    return out


def rng(*key) -> random.Random:
    return random.Random(int(hashlib.md5(repr(key).encode()).hexdigest()[:12], 16))


def noise2(x: float, y: float, seed: int = 0) -> float:
    """Smooth value noise in 0..1 (bilinear over a hashed lattice) for patches and scatter."""
    def h(ix, iy):
        v = (ix * 374761393 + iy * 668265263 + seed * 144269504) & 0xFFFFFFFF
        v = ((v ^ (v >> 13)) * 1274126177) & 0xFFFFFFFF
        return (v & 0xFFFF) / 65535.0
    x0, y0 = math.floor(x), math.floor(y)
    fx, fy = x - x0, y - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b, c, d = h(x0, y0), h(x0 + 1, y0), h(x0, y0 + 1), h(x0 + 1, y0 + 1)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy


# --------------------------------------------------------------------------------------- maps
@dataclass
class Obj:
    sprite: str            # atlas id (frames: id#0, id#1, …)
    x: int                 # px, top-left of the sprite on the map
    y: int
    base: int              # px row where it stands on the ground (depth sorting with actors)
    frames: int = 1
    fps: float = 0
    layer: str = 'sort'    # 'sort' (with actors) | 'top' (always over actors: beams, hanging lamps)
    phase: float = 0


@dataclass
class Npc:
    id: str                # resident id — the game knows his lines and his menu by it
    sheet: str             # chars/<sheet>.png
    x: float               # tiles, feet centre
    y: float
    face: int = 0          # 0 down, 1 up, 2 left, 3 right (the NA sheet columns)
    anim: str = 'idle'     # idle | work (attack row) | pace
    name: str = ''


@dataclass
class Door:
    x: float               # tiles: trigger rect
    y: float
    w: float
    h: float
    to: str                # map id
    at: str                # spawn id in that map
    kind: str = 'enter'    # enter (walk in) | exit (step on the mat) | use (button: lift cage…)
    label: str = ''
    lock: str = ''         # game-side lock id ('dungeon', 'zone') — the page checks it


@dataclass
class Light:
    x: float               # px
    y: float
    r: float               # px
    color: str
    kind: str = 'lamp'     # lamp | fire | window | candle | neon | glow | forge
    night: bool = False    # only at night (street lamps, windows)


@dataclass
class Fx:
    kind: str              # smoke | sparks | embers | steam | dust | drip
    x: float               # px
    y: float
    rate: float = 1.0


class Map:
    """A map in the making. Ground is a picture; everything that stands up is an Obj."""

    def __init__(self, id: str, w: int, h: int, kind: str = 'indoor', name: str = '',
                 ambient: float = 1.0, music: str = 'yard', bg: str = '#120c10'):
        self.id, self.w, self.h, self.kind, self.name = id, w, h, kind, name
        self.ambient, self.music, self.bg = ambient, music, bg
        self.ground = Img.new(w * T, h * T, bg)
        self.solid = np.zeros((h * 2, w * 2), bool)
        self.objs: list[Obj] = []
        self.npcs: list[Npc] = []
        self.doors: list[Door] = []
        self.lights: list[Light] = []
        self.fx: list[Fx] = []
        self.spawns: dict[str, tuple[float, float, int]] = {}
        self.marks: dict[str, tuple[float, float]] = {}   # named points for the page (sign, board…)
        self.searchlights: list[tuple[float, float, float]] = []  # px x, y, phase

    # ground
    def stamp(self, img: Img, x: int, y: int, alpha: float = 1.0) -> None:
        self.ground.paste_(img, x, y, alpha)

    def fill_tiles(self, tile_fn: Callable[[int, int], Img | None], x0=0, y0=0, x1=None, y1=None) -> None:
        x1 = self.w if x1 is None else x1
        y1 = self.h if y1 is None else y1
        for ty in range(y0, y1):
            for tx in range(x0, x1):
                t = tile_fn(tx, ty)
                if t is not None:
                    self.ground.paste_(t, tx * T, ty * T)

    # collision (half-tile cells)
    def block(self, x0: float, y0: float, x1: float, y1: float, v: bool = True) -> None:
        """Mark tiles [x0, x1) × [y0, y1) (fractions snap to half tiles) solid."""
        a, b = int(math.floor(x0 * 2)), int(math.floor(y0 * 2))
        c, d = int(math.ceil(x1 * 2)), int(math.ceil(y1 * 2))
        self.solid[max(0, b):max(0, d), max(0, a):max(0, c)] = v

    def free(self, x0, y0, x1, y1) -> None:
        self.block(x0, y0, x1, y1, False)

    # things
    def put(self, sprite: str, img: Img | list[Img], x: int, y: int, base: int | None = None,
            solid: tuple[float, float, float, float] | None = None, fps: float = 0,
            layer: str = 'sort', phase: float = 0) -> Obj:
        """Place a sprite (or animation frames) with its top-left at px (x, y). base defaults to
        its bottom edge. solid is a tile rect relative to the map (x0, y0, x1, y1)."""
        frames = img if isinstance(img, list) else [img]
        register(sprite, frames)
        o = Obj(sprite, int(x), int(y), int(y + frames[0].h if base is None else base),
                len(frames), fps, layer, phase)
        self.objs.append(o)
        if solid:
            self.block(*solid)
        return o

    def npc(self, id: str, sheet: str, x: float, y: float, face: int = 0, anim: str = 'idle',
            name: str = '') -> Npc:
        n = Npc(id, sheet, x, y, face, anim, name)
        self.npcs.append(n)
        self.block(x - 0.35, y - 0.3, x + 0.35, y + 0.2)
        return n

    def door(self, x, y, w, h, to, at, kind='enter', label='', lock='') -> Door:
        d = Door(x, y, w, h, to, at, kind, label, lock)
        self.doors.append(d)
        return d

    def light(self, x, y, r, color, kind='lamp', night=False) -> None:
        self.lights.append(Light(x, y, r, color, kind, night))

    def emit(self, kind, x, y, rate=1.0) -> None:
        self.fx.append(Fx(kind, x, y, rate))

    def spawn(self, id: str, x: float, y: float, face: int = 0) -> None:
        self.spawns[id] = (x, y, face)


# ------------------------------------------------------------------------ the sprite registry
SPRITES: dict[str, list[Img]] = {}


def register(name: str, frames: list[Img]) -> None:
    """Sprites are registered by id; the same id twice must be the same picture (a map may reuse a
    barrel twenty times, the atlas holds it once)."""
    if name in SPRITES:
        old = SPRITES[name]
        if len(old) != len(frames) or any(o.a.shape != f.a.shape or not np.array_equal(o.a, f.a) for o, f in zip(old, frames)):
            raise ValueError(f'sprite {name!r} registered twice with different pictures')
        return
    SPRITES[name] = frames
