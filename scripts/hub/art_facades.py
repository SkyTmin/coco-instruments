"""The facade artist's hand (v2.80): canvas, roof and wall materials, openings, fittings, props.

Everything the square's buildings are made of lives here; `facades.py` only composes. Seen the
way every top-down RPG town is seen (3/4, the Ninja Adventure houses): the FRONT wall shows its
face, the roof above it covers the footprint shifted up by the wall's height, side walls are not
seen. Geometry (screen px, B = footprint bottom, H = wall height, D = footprint depth):

  front wall     B-H … B
  E–W gable      front slope from the eave (B-H) up to the ridge (B-H-D/2-rise); if rise < D/2
                 a strip of the back slope shows above the ridge, up to B-H-D (it faces the light)
  N–S gable      the gable triangle stands on the wall; the two slopes are parallelograms rising
                 D px from the bargeboards; left slope lit, right in shade; the ridge is vertical
  hip            front trapezoid plus two side triangles, left lit, right shaded
  flat           tar and gravel at B-H-D … B-H inside a parapet

Materials are drawn in NA's manner: 1 px ink contour, 3–5 tones per material from `kit.P`, light
from the upper left, flat fills, chunky details (a nail is one pixel, a brick 8×4). Courses of a
side slope run parallel to its eave, so its texture is the front texture turned and sheared.
"""
from __future__ import annotations

import math

import numpy as np

from kit import INK, P, ink, text, texture
from lib import T, Img, hexrgb, noise2, outline, ramp, rng

# ramps not in kit.P (dark → light)
R = {
    'galv': ['#353c41', '#4b555b', '#66727a', '#87939a', '#adb7ba'],      # galvanised tin
    'tinred': ['#3a1d1b', '#562821', '#74382b', '#8f4d39', '#ab6a52'],    # red-lead painted tin
    'tar': ['#24252a', '#303137', '#3e3f46', '#4f5058', '#64656e'],       # tar paper, sun-greyed
    'shifer': ['#44463f', '#5d5f56', '#777970', '#909186', '#a9a99b'],    # asbestos slate
    'roofgrey': ['#3a3b3d', '#4d4e50', '#606163', '#77787a', '#8f9092'],  # flat roof felt, sun-bleached
    'glass': ['#141c24', '#1e2a35', '#2c3d4b', '#48606f', '#7c96a1'],
    'ochre': ['#6d5436', '#8c6d45', '#ab8957', '#c8a66e', '#dcc28f'],     # Soviet yellow plaster
    'white': ['#7c7a73', '#9f9c92', '#bdbab0', '#d8d5ca', '#ecEAE0'],
    'sidegreen': ['#26352e', '#34493d', '#46604f', '#5d7a64', '#7c977f'],  # painted siding
    'sideblue': ['#26303d', '#344354', '#47596c', '#607489', '#8196a8'],
    'sideochre': ['#4a3a26', '#665035', '#836a45', '#a1865a', '#bda274'],
    'canvas': ['#3c3b2a', '#545338', '#6d6c49', '#8a8860', '#a8a57c'],   # tarp, army green
    'khaki': ['#4a3f2b', '#665a3d', '#83764f', '#a09264', '#bcae80'],
    'steel': ['#1d2126', '#2e343b', '#454d56', '#65707a', '#8e98a0'],
    'hazard': ['#3a2f10', '#6b5617', '#a9861e', '#d8b12e', '#f0d468'],
    'violet': P['violet'],
    'neonpink': ['#5a1036', '#a81e5e', '#ff3d8b', '#ff8fbf', '#ffd6ea'],
    'neoncyan': ['#0d3a44', '#157585', '#27d3e6', '#8af2fb', '#dafcff'],
}

GLOW = '#ffc86a'
WARM = '#ffd98a'


def rp(name: str) -> list[str]:
    return R[name] if name in R else P[name]


# --------------------------------------------------------------------------------- canvas
class Cv:
    """A facade in the making, drawn on a tall canvas and trimmed at the top when done.

    L, R: footprint left/right px; B: footprint bottom px (= canvas bottom); W, D: footprint
    width/depth px. Lights and effects are kept in canvas coords and shifted by the trim."""

    def __init__(self, fw: int, fh: int, over: int = 0, room: int = 280):
        self.fw, self.fh, self.over = fw, fh, over
        self.W, self.D = fw * T, fh * T
        self.img = Img.new(self.W + 2 * over, self.D + room)
        self.L, self.R, self.B = over, over + self.W, self.img.h
        self.lights: list[list] = []
        self.fx: list[list] = []

    @property
    def cx(self) -> int:
        return self.L + self.W // 2

    def light(self, x, y, r, color, kind='window', night=True):
        self.lights.append([x, y, r, color, kind, night])

    def emit(self, kind, x, y, rate=1.0):
        self.fx.append([kind, x, y, rate])

    def door_px(self, dx: float, dw: float) -> tuple[int, int]:
        return self.L + int(round(dx * T)), int(round(dw * T))


def contour(img: Img) -> Img:
    """The facade's silhouette contour, drawn OUTSIDE the shape (1 px of ink), so thin things —
    spokes, bracing, cables, rungs, wire — keep their colour between two ink lines instead of
    turning into ink themselves (which an inner contour does to anything 1–2 px thin). Where the
    shape touches the canvas edge (the ground row, a wall flush with the footprint) the edge
    pixels are inked in place."""
    m = img.a[:, :, 3] > 0
    h, w = m.shape
    grow = np.zeros_like(m)
    grow[1:, :] |= m[:-1, :]
    grow[:-1, :] |= m[1:, :]
    grow[:, 1:] |= m[:, :-1]
    grow[:, :-1] |= m[:, 1:]
    out = img.copy()
    c = hexrgb(INK)
    out.a[grow & ~m] = c
    for sl in (np.s_[-1, :], np.s_[:, 0], np.s_[:, -1]):
        e = m[sl]
        out.a[sl][e] = c
    return out


def trim_top(frames: list[Img], keep: int = 0) -> tuple[list[Img], int]:
    """Cut the transparent rows above everything (the same cut for every frame)."""
    top = min((f.bbox() or (0, f.h, 0, f.h))[1] for f in frames)
    top = max(0, top - keep)
    return [f.crop(0, top, f.w, f.h - top) for f in frames], top


# ---------------------------------------------------------------------------- mask tools
def poly_mask(w: int, h: int, pts) -> np.ndarray:
    m = Img.new(w, h)
    m.poly_(pts, '#ffffff')
    return m.a[:, :, 3] > 0


def put_masked(dst: Img, src: Img, x: int, y: int, mask: np.ndarray | None = None) -> None:
    """Paste src at (x, y) through a mask of dst's size (True = draw)."""
    if mask is None:
        dst.paste_(src, x, y)
        return
    full = Img.new(dst.w, dst.h)
    full.paste_(src, x, y)
    full.a[~mask, 3] = 0
    dst.paste_(full, 0, 0)


def fill_poly(dst: Img, pts, src: Img | str, x: int | None = None, y: int | None = None) -> np.ndarray:
    """Fill a polygon with a colour or a picture placed at (x, y) (default: polygon's bbox)."""
    m = poly_mask(dst.w, dst.h, pts)
    if isinstance(src, str):
        full = Img.new(dst.w, dst.h, src)
        full.a[~m, 3] = 0
        dst.paste_(full, 0, 0)
        return m
    if x is None:
        x = int(math.floor(min(p[0] for p in pts)))
        y = int(math.floor(min(p[1] for p in pts)))
    put_masked(dst, src, x, y, m)
    return m


def edge(dst: Img, mask: np.ndarray, color: str = INK, sides: str = 'lrtb') -> None:
    """Ink the inner ring of a mask on the chosen sides (l, r, t, b)."""
    e = np.zeros_like(mask)
    if 't' in sides:
        e |= mask & ~np.roll(mask, 1, 0)
    if 'b' in sides:
        e |= mask & ~np.roll(mask, -1, 0)
    if 'l' in sides:
        e |= mask & ~np.roll(mask, 1, 1)
    if 'r' in sides:
        e |= mask & ~np.roll(mask, -1, 1)
    c = hexrgb(color)
    dst.a[e] = c


def shear_up(img: Img, k: float) -> Img:
    """Shift column x up by round(k·x) — a texture laid on a slope that rises to the right."""
    ext = int(math.ceil(abs(k) * img.w)) + 1
    out = Img.new(img.w, img.h + ext)
    for x in range(img.w):
        s = int(round(k * x))
        out.a[ext - s:ext - s + img.h, x] = img.a[:, x]
    return out


def shade(img: Img, k: float) -> Img:
    return img.mul(k)


def mix(a: str, b: str, t: float) -> str:
    ra, rb = hexrgb(a), hexrgb(b)
    return '#%02x%02x%02x' % tuple(int(ra[i] + (rb[i] - ra[i]) * t + 0.5) for i in range(3))


# --------------------------------------------------------------------------- roof courses
def courses(kind: str, w: int, h: int, seed: int = 1) -> Img:
    """A roof covering seen on a slope facing the viewer: courses run left–right, the eave is the
    bottom edge, the ridge the top. kinds: slate, shingle, tin, tinred, galv, tar, canvas."""
    r = rng('courses', kind, w, h, seed)
    out = Img.new(w, h)
    if kind in ('slate', 'shingle'):
        c = P['slate'] if kind == 'slate' else P['woodgrey']
        ch = 5 if kind == 'slate' else 6
        out.rect_(0, 0, w, h, c[0])
        row = 0
        for y in range(h - ch, -ch, -ch):          # from the eave up, so the eave row is whole
            x = -((row % 2) * 4 + r.randrange(0, 3))
            grad = 1 if y < h * 0.22 else (-1 if y > h * 0.8 else 0)
            while x < w:
                tw = r.choice([6, 7, 8, 8, 9]) if kind == 'slate' else r.choice([5, 6, 6, 7, 8])
                k = r.random()
                if kind == 'slate':
                    base = 2 if k < 0.62 else (1 if k < 0.8 else 3)
                else:
                    base = 2 if k < 0.75 else (3 if k < 0.9 else 1)
                base = max(1, min(3, base + grad))
                out.rect_(x + 1, y, tw - 1, ch - 1, c[base])
                out.rect_(x + 1, y, tw - 1, 1, c[min(4, base + 1)])
                out.px_(x + 1, y + ch - 2, c[max(0, base - 1)])
                if r.random() < 0.05:                   # a lichen spot
                    out.px_(x + r.randrange(1, max(2, tw - 1)), y + 1, P['leaf'][2])
                x += tw
            row += 1
        return out
    if kind in ('tin', 'tinred', 'galv'):
        c = P['tin'] if kind == 'tin' else R[kind]
        sheet_w = 24
        seam = r.choice([20, 22, 24])
        for sx in range(0, w, sheet_w):
            tone = r.choice([0, 0, 0, 1, -1])
            for x in range(sx, min(w, sx + sheet_w)):
                k = (x - sx) % 4
                idx = [3, 2, 1, 2][k] + tone
                out.rect_(x, 0, 1, h, c[max(0, min(4, idx))])
            out.rect_(sx, 0, 1, h, c[0])
        for y in range(h - seam, -seam, -seam):
            out.rect_(0, y, w, 1, c[0])
            out.rect_(0, y + 1, w, 1, c[4])
            for x in range(2, w, 8):                   # nail heads and the rust they bleed
                out.px_(x, y + 2, c[4])
                if r.random() < 0.35:
                    ln = r.randrange(2, 7)
                    out.rect_(x, y + 3, 1, ln, P['rust'][r.randrange(1, 4)], 0.8)
        painted = kind in ('tin', 'tinred')
        for _ in range(max(1, w * h // (2400 if painted else 900))):          # rust patches
            x, y = r.randrange(0, w), r.randrange(0, h)
            out.ellipse_(x, y, r.uniform(1.5, 3.5), r.uniform(1, 2), P['rust'][r.randrange(0, 2) if painted else r.randrange(1, 4)], 0.6 if painted else 0.75)
        return out
    if kind == 'shifer':
        # wavy asbestos-cement sheets (шифер), the Soviet roof: waves down the slope, rows of
        # sheets overlapping with a scalloped lower edge, lichen and weathered darker sheets
        c = R['shifer']
        sh_h = r.choice([18, 19, 20])
        wave = [4, 3, 2, 1, 1, 2]
        row = 0
        for y in range(h - sh_h, -sh_h, -sh_h):
            off = (row % 2) * 15 + r.randrange(0, 3)
            x = -off
            while x < w:
                sw = r.choice([28, 30, 30, 32])
                tone = r.choice([0, 0, 0, 0, -1, -1, 1])
                for xx in range(x, x + sw):
                    k = wave[(xx - x) % 6]
                    col = c[max(0, min(4, k + tone))]
                    out.rect_(xx, y, 1, sh_h, col)
                    if (xx - x) % 6 in (3, 4):
                        out.px_(xx, y + sh_h - 1, c[0])       # scallop: dark under the troughs
                    else:
                        out.px_(xx, y + sh_h - 1, c[max(0, 1 + tone)])
                out.rect_(x + sw - 1, y, 1, sh_h - 1, c[0])  # the overlap of the next sheet
                if r.random() < 0.08:                          # a broken corner
                    out.poly_([(x + sw - 7, y + sh_h), (x + sw, y + sh_h), (x + sw, y + sh_h - 6)], c[0])
                x += sw
            row += 1
        for _ in range(max(2, w * h // 160)):                 # lichen, gathered in the troughs
            x, y = r.randrange(0, w), r.randrange(0, h)
            if noise2(x / 14, y / 10, seed) > 0.52:
                out.px_(x, y, r.choice(['#8f9a4a', '#a9a85a', '#6f7d44']))
        return out
    if kind == 'tar':
        c = R['tar']
        strip = 9
        out.rect_(0, 0, w, h, c[2])
        for i, y in enumerate(range(h - strip, -strip, -strip)):
            tone = r.choice([2, 2, 1, 3])
            out.rect_(0, y, w, strip, c[tone])
            out.rect_(0, y, w, 1, c[min(4, tone + 1)])
            out.rect_(0, y + strip - 1, w, 1, c[0])
            for _ in range(w // 10):
                out.px_(r.randrange(0, w), y + r.randrange(1, strip - 1), c[max(0, tone - 1)])
        # patches of newer paper and of flattened tin
        for _ in range(max(1, w * h // 1500)):
            pw, ph = r.randrange(8, 16), r.randrange(5, 9)
            x, y = r.randrange(0, max(1, w - pw)), r.randrange(0, max(1, h - ph))
            col = r.choice([c[3], c[1], R['galv'][2]])
            out.rect_(x, y, pw, ph, col)
            out.rect_(x, y, pw, 1, mix(col, '#ffffff', 0.15))
            out.rect_(x, y + ph - 1, pw, 1, c[0])
        # battens (рейки) nailed down the slope
        wd = P['woodgrey']
        for x in range(r.randrange(6, 14), w, r.choice([26, 30])):
            out.rect_(x, 0, 2, h, wd[1])
            out.rect_(x, 0, 1, h, wd[2])
            out.rect_(x + 2, 0, 1, h, c[0])
            for y in range(h - strip + 1, 0, -strip):
                out.px_(x, y, wd[3])
        return out
    if kind in ('canvas', 'khaki'):
        # a tarp: it sags in bays between the ropes (light crest at each rope, shade in the belly),
        # wrinkles run down the slope, it darkens toward the eave where the rain sits
        c = R[kind]
        bay = 22
        off = r.randrange(0, 8)
        for x in range(w):
            t = ((x + off) % bay) / bay
            base = 3 if t < 0.12 else (1 if t > 0.82 else 2)
            for y in range(h):
                v = y / max(1, h - 1)
                idx = base - (1 if v > 0.78 and base > 1 else 0)
                out.px_(x, y, c[idx])
        for _ in range(w // 3):                                  # wrinkles down the slope
            x, y = r.randrange(0, w), r.randrange(0, h)
            ln = r.randrange(4, 12)
            out.rect_(x, y, 1, ln, c[r.choice([1, 3])])
        for _ in range(max(1, w * h // 700)):
            out.px_(r.randrange(0, w), r.randrange(0, h), c[1])
        for _ in range(max(1, w * h // 2500)):                   # a patch sewn on
            pw, ph = r.randrange(7, 12), r.randrange(5, 8)
            x, y = r.randrange(0, max(1, w - pw)), r.randrange(0, max(1, h - ph))
            out.rect_(x, y, pw, ph, R['khaki'][2] if kind == 'canvas' else R['canvas'][2])
            for xx in range(x, x + pw, 2):
                out.px_(xx, y, c[4]); out.px_(xx, y + ph - 1, c[4])
            for yy in range(y, y + ph, 2):
                out.px_(x, yy, c[4]); out.px_(x + pw - 1, yy, c[4])
        return out
    raise ValueError(kind)


ROOF_EDGE = {
    'slate': P['slate'], 'shingle': P['woodgrey'], 'tin': P['tin'], 'tinred': R['tinred'],
    'galv': R['galv'], 'tar': R['tar'], 'canvas': R['canvas'], 'khaki': R['khaki'],
    'shifer': R['shifer'],
}


# ---------------------------------------------------------------------------- wall materials
def wall(kind: str, w: int, h: int, seed: int = 1, tone: str | None = None) -> Img:
    """Front-wall materials. kit.texture ones plus logs (round, with tow in the joints), siding
    (horizontal weatherboard, painted and peeling), plaster (coloured, dirty at the base),
    panel (precast concrete), corr (corrugated tin, vertical)."""
    r = rng('wall', kind, w, h, seed)
    if kind in ('brick', 'brickgrey', 'stone', 'planks', 'plankgrey', 'concrete'):
        return texture(kind, w, h, seed)
    out = Img.new(w, h)
    if kind == 'logs':
        c = P['wood'] if tone is None else rp(tone)
        lh = 7
        for i, y in enumerate(range(h - lh, -lh, -lh)):
            base = r.choice([2, 2, 3, 1, 2])
            out.rect_(0, y, w, lh, c[base])
            out.rect_(0, y + 1, w, 1, c[min(4, base + 1)])
            out.rect_(0, y + 2, w, 1, c[min(4, base + 2)] if base < 3 else c[4])
            out.rect_(0, y + lh - 2, w, 1, c[max(0, base - 1)])
            out.rect_(0, y + lh - 1, w, 1, c[0])
            out.rect_(0, y, w, 1, '#8a7a5a')              # tow (пакля) caulked in the joint
            for _ in range(w // 12):                       # cracks along the grain
                x = r.randrange(0, w)
                out.rect_(x, y + 3, r.randrange(3, 8), 1, c[max(0, base - 1)])
            for _ in range(w // 40):                       # knots
                x = r.randrange(2, w - 2)
                out.px_(x, y + 3, c[0]); out.px_(x + 1, y + 3, c[1])
        return out
    if kind == 'siding':
        c = rp(tone or 'sidegreen')
        bh = 4
        for y in range(h - bh, -bh, -bh):
            out.rect_(0, y, w, bh, c[2])
            out.rect_(0, y, w, 1, c[3])
            out.rect_(0, y + bh - 1, w, 1, c[0])
        # paint peeled to grey wood in patches, darker where rain runs
        for _ in range(max(1, w * h // 450)):
            x, y = r.randrange(0, w), r.randrange(0, h)
            pw = r.randrange(3, 9)
            y -= y % bh
            wd = P['woodgrey']
            out.rect_(x, y + 1, pw, bh - 2, wd[3])
            out.px_(x, y + 1, wd[4])
        for _ in range(max(1, w // 30)):
            x = r.randrange(0, w)
            out.rect_(x, 0, r.randrange(1, 3), r.randrange(h // 3, h), c[1], 0.35)
        return out
    if kind == 'plaster':
        c = rp(tone or 'plaster')
        out.rect_(0, 0, w, h, c[3])
        for y in range(h):                                  # darker at the base (rain splash)
            k = max(0, (y - h * 0.72) / (h * 0.28))
            if k > 0:
                out.rect_(0, y, w, 1, c[1], 0.5 * k)
        for _ in range(max(1, w * h // 1100)):              # bald patches with brick showing
            px, py = r.randrange(0, w), r.randrange(0, h)
            pw, ph = r.randrange(7, 14), r.randrange(4, 8)
            patch = texture('brick', pw, ph, r.randrange(1000))
            m = Img.new(pw, ph)
            m.ellipse_(pw / 2, ph / 2, pw / 2, ph / 2, '#ffffff')
            patch.a[:, :, 3] = m.a[:, :, 3]
            out.ellipse_(px + pw / 2, py + ph / 2, pw / 2 + 1, ph / 2 + 1, c[4])
            out.paste_(patch, px, py)
            out.ellipse_(px + pw / 2 - 0.5, py + ph / 2 - 0.5, pw / 2, ph / 2, c[1], 0.25)
        for _ in range(max(1, w // 26)):                    # rain streaks
            x = r.randrange(0, w)
            out.rect_(x, 0, r.randrange(1, 3), r.randrange(h // 4, h // 2), c[2], 0.55)
        for _ in range(max(1, w * h // 800)):               # hairline cracks
            x, y = r.randrange(0, w), r.randrange(0, h)
            for k in range(r.randrange(3, 7)):
                out.px_(x, y, c[1])
                x += r.choice([-1, 0, 1]); y += 1
        return out
    if kind == 'panel':
        c = P['concrete']
        out.rect_(0, 0, w, h, c[2])
        pw, ph = 32, 16
        for y in range(h, -ph, -ph):
            for x in range(0, w, pw):
                tone = r.choice([2, 2, 3, 1])
                out.rect_(x, y - ph, pw, ph, c[tone])
                out.rect_(x, y - ph, pw, 1, c[min(4, tone + 1)])
                out.rect_(x, y - ph, 1, ph, c[min(4, tone + 1)])
                out.rect_(x + pw - 1, y - ph, 1, ph, c[0])
                out.rect_(x, y - 1, pw, 1, c[0])
        for _ in range(max(1, w * h // 300)):
            out.px_(r.randrange(0, w), r.randrange(0, h), c[1])
        for _ in range(max(1, w // 18)):                     # rust weeping from the rebar
            x, y = r.randrange(0, w), r.randrange(0, h // 2)
            out.rect_(x, y, 1, r.randrange(4, 10), P['rust'][2], 0.55)
        return out
    if kind == 'corr':
        c = rp(tone or 'galv')
        for x in range(w):
            out.rect_(x, 0, 1, h, c[[3, 2, 1, 2][x % 4]])
        for x in range(0, w, 28):
            out.rect_(x, 0, 1, h, c[0])
        for y in range(4, h, 12):
            for x in range(1, w, 4):
                out.px_(x, y, c[4])
        for _ in range(max(1, w * h // 500)):
            x, y = r.randrange(0, w), r.randrange(0, h)
            out.rect_(x, y, 1, r.randrange(2, 7), P['rust'][r.randrange(1, 4)], 0.8)
        return out
    raise ValueError(kind)


# ------------------------------------------------------------------------------ walls
def front_wall(cv: Cv, kind: str, H: int, seed: int = 1, tone: str | None = None, plinth: int = 5,
               plinth_mat: str = 'stone', x0: int | None = None, x1: int | None = None) -> None:
    """The front wall face from B-H to B, with a plinth (цоколь) at its foot and corner shading."""
    img = cv.img
    x0 = cv.L if x0 is None else x0
    x1 = cv.R if x1 is None else x1
    w = x1 - x0
    img.paste_(wall(kind, w, H, seed, tone), x0, cv.B - H)
    if plinth:
        p = texture('stone', w, plinth, seed + 3) if plinth_mat == 'stone' else wall(plinth_mat, w, plinth, seed + 3)
        img.paste_(p, x0, cv.B - plinth)
        img.rect_(x0, cv.B - plinth, w, 1, P['stone'][4] if plinth_mat == 'stone' else P['concrete'][4])
        img.rect_(x0, cv.B - plinth - 1, w, 1, '#000000', 0.35)
    # the corners turn away from the light: right edge darker, left edge lighter
    img.rect_(x1 - 3, cv.B - H, 3, H, '#000000', 0.22)
    img.rect_(x0, cv.B - H, 2, H, '#ffffff', 0.10)


def log_ends(img: Img, x: int, y0: int, y1: int, side: str = 'l', tone: str | None = None) -> None:
    """Protruding log ends at a corner of a log wall (the izba's corner): rings, dark heart."""
    c = P['wood'] if tone is None else rp(tone)
    for y in range(y1 - 7, y0 - 7, -7):
        img.ellipse_(x, y + 3.5, 4.2, 3.7, INK)
        img.ellipse_(x, y + 3.5, 3.4, 2.9, c[1])
        img.ellipse_(x - 0.5, y + 3.0, 2.7, 2.2, c[3])
        img.ellipse_(x - 0.5, y + 3.0, 1.4, 1.1, c[4])
        img.px_(x, y + 3, c[2])


# ------------------------------------------------------------------------------- roofs
def eave_shadow(cv: Cv, y: int, x0: int | None = None, x1: int | None = None, depth: int = 4) -> None:
    x0 = cv.L if x0 is None else x0
    x1 = cv.R if x1 is None else x1
    for i, a in enumerate((0.45, 0.32, 0.2, 0.1)[:depth]):
        cv.img.rect_(x0, y + i, x1 - x0, 1, '#000000', a)


def roof_ew(cv: Cv, kind: str, H: int, rise: int | None = None, ov: int = 3, drop: int = 2,
            seed: int = 1, x0: int | None = None, x1: int | None = None, D: int | None = None) -> dict:
    """Gable roof with its ridge along the front (E–W). Returns key y's: eave, ridge, top."""
    img = cv.img
    D = cv.D if D is None else D
    rise = D // 2 - 8 if rise is None else rise
    x0 = (cv.L if x0 is None else x0) - ov
    x1 = (cv.R if x1 is None else x1) + ov
    w = x1 - x0
    eave = cv.B - H + drop
    ridge = cv.B - H - D // 2 - rise
    back = cv.B - H - D
    front = courses(kind, w, eave - ridge, seed)
    front = front.mul(1.0)
    img.paste_(front, x0, ridge)
    top = ridge
    c = ROOF_EDGE[kind]
    if ridge > back:                       # the back slope shows above the ridge, in the light
        bk = courses(kind, w, ridge - back, seed + 5).flipv().mul(1.12)
        img.paste_(bk, x0, back)
        img.rect_(x0, ridge - 2, w, 1, INK)
        top = back
    # ridge cap
    img.rect_(x0, ridge - 1, w, 3, c[3])
    img.rect_(x0, ridge - 1, w, 1, c[4])
    img.rect_(x0, ridge + 2, w, 1, c[0])
    for x in range(x0 + 5, x1, 9):
        img.px_(x, ridge, c[1])
    # verge boards at the gable ends, fascia along the eave
    img.rect_(x0, top, 2, eave - top, c[3]); img.rect_(x0, top, 1, eave - top, c[4])
    img.rect_(x1 - 2, top, 2, eave - top, c[1])
    img.rect_(x0, eave - 2, w, 2, c[1])
    img.rect_(x0, eave - 2, w, 1, c[3])
    img.rect_(x0, eave, w, 1, INK)
    eave_shadow(cv, eave + 1, x0 + ov, x1 - ov)
    return {'eave': eave, 'ridge': ridge, 'top': top, 'x0': x0, 'x1': x1}


def roof_hip(cv: Cv, kind: str, H: int, rise: int | None = None, ov: int = 3, drop: int = 2,
             seed: int = 1, x0: int | None = None, x1: int | None = None, D: int | None = None) -> dict:
    """Hip roof: the front trapezoid, the two side triangles (left lit, right in shade) and — when
    the pitch is low enough for the ridge to sit below the back eave on screen — the back slope,
    which faces the light and shows as a lighter band along the top."""
    img = cv.img
    D = cv.D if D is None else D
    rise = D // 2 - 6 if rise is None else rise
    x0 = (cv.L if x0 is None else x0) - ov
    x1 = (cv.R if x1 is None else x1) + ov
    w = x1 - x0
    eave = cv.B - H + drop
    ridge = cv.B - H - D // 2 - rise
    back = cv.B - H - D
    inset = min(w // 2 - 4, (D // 2) * 3 // 4 + ov)
    rl, rr_ = x0 + inset, x1 - inset
    top = min(ridge, back)
    c = ROOF_EDGE[kind]
    if ridge > back:                                           # the back slope shows
        bk = courses(kind, w, ridge - back + 2, seed + 5).flipv().mul(1.1)
        fill_poly(img, [(x0, back), (x1, back), (rr_, ridge + 1), (rl, ridge + 1)], bk, x0, back)
    side = courses(kind, eave - top + 8, inset + 2, seed + 2).rot90(1)
    fill_poly(img, [(x0, eave + 1), (x0, back), (rl, ridge), (rl + 0.5, eave + 1)], side.mul(1.14), x0, top)
    fill_poly(img, [(x1, eave + 1), (x1, back), (rr_, ridge), (rr_ - 0.5, eave + 1)], side.flip().mul(0.74), x1 - inset - 2, top)
    fr = courses(kind, w, eave - ridge, seed)
    fill_poly(img, [(x0 - 0.5, eave + 1), (rl, ridge), (rr_, ridge), (x1 + 0.5, eave + 1)], fr, x0, ridge)
    # hips (front and back) and the ridge cap
    img.line_(x0, eave, rl, ridge, c[4]); img.line_(x0 + 1, eave, rl + 1, ridge, c[3])
    img.line_(x1 - 1, eave, rr_, ridge, c[2]); img.line_(x1 - 2, eave, rr_ - 1, ridge, c[3])
    if ridge > back:
        img.line_(x0, back, rl, ridge, c[4]); img.line_(x1 - 1, back, rr_, ridge, c[1])
    img.rect_(rl, ridge - 1, rr_ - rl, 3, c[3]); img.rect_(rl, ridge - 1, rr_ - rl, 1, c[4])
    img.rect_(rl, ridge + 2, rr_ - rl, 1, c[0])
    # eave fascia
    img.rect_(x0, eave - 2, w, 2, c[1]); img.rect_(x0, eave - 2, w, 1, c[3])
    img.rect_(x0, eave, w, 1, INK)
    eave_shadow(cv, eave + 1, x0 + ov, x1 - ov)
    return {'eave': eave, 'ridge': ridge, 'top': top, 'x0': x0, 'x1': x1, 'rl': rl, 'rr': rr_}


def roof_gable(cv: Cv, kind: str, H: int, profile: list[tuple[float, int]], gable: str = 'planks',
               ov: int = 3, seed: int = 1, x0: int | None = None, x1: int | None = None,
               D: int | None = None, gable_tone: str | None = None, barge: str = 'wood') -> dict:
    """A roof whose ridge runs away from the viewer (N–S), given by its gable profile: a list of
    (fraction of the width, rise above the eave) from the left eave to the right one —
    [(0, 0), (.5, 30), (1, 0)] is a plain gable, five points make a gambrel barn roof. Each profile
    segment becomes a slope D px deep, shaded by how it faces the light (rising = lit)."""
    img = cv.img
    D = cv.D if D is None else D
    x0 = (cv.L if x0 is None else x0) - ov
    x1 = (cv.R if x1 is None else x1) + ov
    eave = cv.B - H
    pts = [(x0 + (x1 - 1 - x0) * f, eave - rise) for f, rise in profile]
    for i in range(len(pts) - 1):
        (xa, ya), (xb, yb) = pts[i], pts[i + 1]
        sw = int(math.ceil(xb - xa)) + 2
        k = (ya - yb) / max(1e-6, xb - xa)
        tex = courses(kind, D + 4, sw, seed + i * 7).rot90(1)
        if k >= 0:
            sh = shear_up(tex, k)
            y0 = int(ya) - D - 2 - (sh.h - tex.h)
        else:
            sh = shear_up(tex.flip(), -k).flip()
            y0 = int(yb) - D - 2 - (sh.h - tex.h)
        light = 1.0 + 0.1 * min(1.5, k) if k >= 0 else 0.84 + 0.1 * max(-1.5, k)
        quad = [(xa, ya + 1), (xb, yb + 1), (xb, yb - D), (xa, ya - D)]
        fill_poly(img, quad, sh.mul(light), int(xa) - 1, y0)
    c = ROOF_EDGE[kind]
    # creases: the ridge and the knees run straight back (vertical on screen)
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        hi = pts[i][1] <= min(pts[i - 1][1], pts[i + 1][1])
        img.rect_(int(x) - 1, int(y) - D, 3 if hi else 2, D + 2, c[3] if hi else c[1])
        img.rect_(int(x) - 1, int(y) - D, 1, D + 2, c[4] if hi else c[2])
    # the gable in the wall material, bargeboards along the profile
    poly = [(x0 + ov, eave + 1)] + [(max(x0 + ov, min(x1 - ov, x)), y + 2) for x, y in pts[1:-1]] + [(x1 - ov, eave + 1)]
    top_y = min(y for _, y in pts)
    gt = wall(gable, x1 - x0, eave - top_y + 4, seed + 4, gable_tone)
    gm = fill_poly(img, poly, gt, x0, int(top_y))
    img.rect_(x0 + ov, eave - 1, x1 - x0 - 2 * ov, 1, '#000000', 0.25)
    wd = P['wood'] if barge == 'wood' else rp(barge)
    for i in range(len(pts) - 1):
        (xa, ya), (xb, yb) = pts[i], pts[i + 1]
        rising = ya >= yb
        for t in range(3):
            col = [wd[4], wd[3], wd[1]][t] if rising else [wd[2], wd[2], wd[0]][t]
            img.line_(int(xa), int(ya) + t - 1, int(xb), int(yb) + t - 1, col)
        img.line_(int(xa), int(ya) + 2, int(xb), int(yb) + 2, INK)
        img.line_(int(xa), int(ya) - 2, int(xb), int(yb) - 2, INK)
        for t in range(3, 6):
            img.line_(int(xa) + (t if rising else -t), int(ya) + t - 1, int(xb), int(yb) + t - 1, '#000000', 0.16)
    apex = min(pts, key=lambda p: p[1])
    return {'eave': eave, 'apex': int(apex[1]), 'top': int(apex[1]) - D, 'cx': apex[0], 'gable': gm,
            'x0': x0, 'x1': x1, 'pts': pts, 'D': D,
            'k': (pts[0][1] - pts[1][1]) / max(1e-6, pts[1][0] - pts[0][0])}


def roof_ns(cv: Cv, kind: str, H: int, rise: int, gable: str = 'planks', ov: int = 3,
            seed: int = 1, x0: int | None = None, x1: int | None = None, D: int | None = None,
            gable_tone: str | None = None) -> dict:
    """Front gable (ridge N–S): the gable triangle stands on the wall, the slopes rise behind it."""
    return roof_gable(cv, kind, H, [(0, 0), (0.5, rise), (1, 0)], gable, ov, seed, x0, x1, D, gable_tone)


def slope_y(roof: dict, x: float, depth: float) -> float:
    """Screen y of a point on a roof_gable roof: column x, `depth` px back from the front."""
    pts = roof['pts']
    for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
        if xa <= x <= xb:
            return ya + (yb - ya) * (x - xa) / max(1e-6, xb - xa) - depth
    return pts[0][1] - depth


def roof_flat(cv: Cv, H: int, D: int | None = None, parapet: int = 4, mat: str = 'brick',
              seed: int = 1, x0: int | None = None, x1: int | None = None, surface: str = 'tar',
              tone: str | None = None) -> dict:
    """Flat roof inside a parapet. The front parapet is the top of the front wall (H includes it);
    the back parapet shows its inner face, the side parapets their tops."""
    img = cv.img
    D = cv.D if D is None else D
    x0 = cv.L if x0 is None else x0
    x1 = cv.R if x1 is None else x1
    w = x1 - x0
    top = cv.B - H - D + parapet          # the roof surface's far edge
    near = cv.B - H                        # the front parapet's top face
    r = rng('flat', w, D, seed)
    c = R['tar'] if surface == 'tar' else R['roofgrey']
    img.rect_(x0, top, w, near - top, c[2])
    for y in range(top, near):                               # tar sheets laid in strips
        if (y - top) % 12 == 11:
            img.rect_(x0, y, w, 1, c[1])
        elif (y - top) % 12 == 0:
            img.rect_(x0, y, w, 1, c[3])
    for _ in range(w * (near - top) // 45):                 # gravel, one tone off
        x, y = r.randrange(x0, x1), r.randrange(top, near)
        img.px_(x, y, r.choice([c[1], c[3]]))
    for _ in range(max(1, w * D // 2600)):                   # a shallow puddle, sky in it
        px, py = r.randrange(x0 + 12, x1 - 12), r.randrange(top + 8, near - 8)
        rw, rh = r.uniform(5, 8), r.uniform(1.6, 2.4)
        img.ellipse_(px, py, rw + 1, rh + 1, c[1])
        img.ellipse_(px, py, rw, rh, '#56646c')
        img.rect_(int(px - rw / 2), int(py - 1), int(rw), 1, '#8a9ba3')
    for _ in range(max(1, w * D // 1400)):                   # patches of newer felt, bitumen seams
        pw, ph = r.randrange(8, 18), r.randrange(5, 9)
        px, py = r.randrange(x0 + 4, max(x0 + 5, x1 - pw - 4)), r.randrange(top + 3, max(top + 4, near - ph - 5))
        img.rect_(px, py, pw, ph, c[1])
        img.rect_(px, py, pw, 1, c[3]); img.rect_(px, py + ph - 1, pw, 1, c[0])
        img.rect_(px, py, 1, ph, c[3])
    # a drain funnel near the front
    img.ellipse_(x1 - 10, near - 8, 2.5, 1.5, c[0]); img.px_(x1 - 11, near - 9, c[3])
    # the back parapet's inner face and top, the side parapets' tops
    pf = wall(mat, w, parapet + 2, seed + 11, tone).mul(0.92)
    img.paste_(pf, x0, top - 2)
    img.rect_(x0, top - parapet - 1, w, 3, P['concrete'][3])
    img.rect_(x0, top - parapet - 1, w, 1, P['concrete'][4])
    img.rect_(x0, top - parapet - 2, w, 1, INK)
    img.rect_(x0, top + parapet // 2 + 1, w, 2, '#000000', 0.25)
    img.rect_(x0, top - parapet - 1, 3, near - top + parapet + 1, P['concrete'][3])
    img.rect_(x0, top - parapet - 1, 1, near - top + parapet + 1, P['concrete'][4])
    img.rect_(x1 - 3, top - parapet - 1, 3, near - top + parapet + 1, P['concrete'][2])
    img.rect_(x0 + 3, top, 2, near - top, '#000000', 0.2)
    # the front parapet's top (coping)
    img.rect_(x0, near - 3, w, 3, P['concrete'][3])
    img.rect_(x0, near - 3, w, 1, P['concrete'][4])
    img.rect_(x0, near, w, 1, P['concrete'][1])
    img.rect_(x0, near - 4, w, 1, INK)
    img.rect_(x0, top - parapet - 2, 1, near - top + parapet + 2, INK)
    img.rect_(x1 - 1, top - parapet - 2, 1, near - top + parapet + 2, INK)
    return {'top': top - parapet - 2, 'near': near, 'surface': (x0 + 3, top, x1 - 3, near - 4)}


# ----------------------------------------------------------------------------- openings
def window(w: int = 14, h: int = 17, frame: str = 'white', bars: int = 0, kind: str = 'sash',
           sill: bool = True, curtain: str | None = None, seed: int = 1, broken: bool = False) -> Img:
    """An exterior window: casing, dark glass with the sky's reflection, a T-frame with a vent pane
    (форточка), optional bars and curtains, a tin sill. The glass is dark by day; the square lights
    it at night (`lights`, kind window)."""
    r = rng('win', w, h, frame, seed)
    fc = {'white': R['white'], 'wood': P['wood'], 'green': R['sidegreen'], 'blue': R['sideblue'],
          'iron': R['steel'], 'ochre': R['ochre']}[frame]
    sh = 3 if sill else 0
    out = Img.new(w, h + sh)
    out.rect_(0, 0, w, h, fc[3])                      # casing
    out.rect_(0, 0, w, 1, fc[4])
    out.rect_(w - 1, 0, 1, h, fc[1])
    g = R['glass']
    gx0, gy0, gx1, gy1 = 2, 2, w - 2, h - 2
    out.rect_(gx0, gy0, gx1 - gx0, gy1 - gy0, g[1])
    out.rect_(gx0, gy0, gx1 - gx0, 2, g[0])            # recess shadow under the lintel
    out.rect_(gx0, gy0, 1, gy1 - gy0, g[0])
    # sky reflection: a pale diagonal band and a glint
    for i in range(gy1 - gy0):
        x = gx1 - 3 - i // 2
        if gx0 + 1 <= x < gx1:
            out.px_(x, gy0 + i + 1, g[3])
            if x + 1 < gx1:
                out.px_(x + 1, gy0 + i + 1, g[2])
    out.px_(gx1 - 2, gy0 + 1, g[4])
    if curtain:
        cr = ramp(curtain, 4, 0.35)
        out.rect_(gx0, gy0, 3, gy1 - gy0, cr[2]); out.rect_(gx0, gy0, 1, gy1 - gy0, cr[3])
        out.rect_(gx1 - 3, gy0, 3, gy1 - gy0, cr[1])
    if broken:
        x, y = gx0 + 2, gy0 + 3
        for k in range(5):
            out.px_(x, y, g[4]); x += r.choice([0, 1]); y += 1
    # frame: mullion, transom, the vent pane
    if kind == 'sash':
        mx = gx0 + (gx1 - gx0) // 2
        ty = gy0 + (gy1 - gy0) // 3
        out.rect_(mx, gy0, 1, gy1 - gy0, fc[2])
        out.rect_(gx0, ty, gx1 - gx0, 1, fc[2])
        out.px_(mx, ty, fc[3])
    elif kind == 'grid':
        for x in range(gx0 + 3, gx1, 4):
            out.rect_(x, gy0, 1, gy1 - gy0, fc[2])
        for y in range(gy0 + 4, gy1, 5):
            out.rect_(gx0, y, gx1 - gx0, 1, fc[2])
    if bars:
        st = R['steel']
        cy = gy0 + (gy1 - gy0) * 2 // 3
        out.rect_(1, cy, w - 2, 1, st[3]); out.rect_(1, cy + 1, w - 2, 1, st[0])
        for i in range(1, bars + 1):
            x = gx0 + ((gx1 - gx0) * i) // (bars + 1)
            out.rect_(x, 1, 1, h - 1, st[3])
            out.rect_(x + 1, 2, 1, h - 3, st[0])
            out.px_(x, 1, st[4])
    out = ink(out.crop(0, 0, w, h)).crop(0, 0, w, h + sh)
    if sill:
        out.rect_(-1 + 0, h, w, 2, P['concrete'][3] if frame != 'wood' else P['wood'][3])
        out.rect_(0, h, w, 1, P['concrete'][4] if frame != 'wood' else P['wood'][4])
        out.rect_(0, h + 2, w, 1, INK)
        out.rect_(0, h, 1, 3, INK); out.rect_(w - 1, h, 1, 3, INK)
    return out


def round_window(d: int = 10, frame: str = 'brick', glow: str | None = None) -> Img:
    out = Img.new(d + 2, d + 2)
    fc = P['stone'] if frame == 'stone' else (P['brick'] if frame == 'brick' else P['wood'])
    c = (d + 2) / 2
    out.ellipse_(c, c, d / 2 + 1, d / 2 + 1, INK)
    out.ellipse_(c, c, d / 2, d / 2, fc[3])
    out.ellipse_(c + 0.4, c + 0.4, d / 2 - 1.5, d / 2 - 1.5, glow or R['glass'][1])
    if glow:
        gr = ramp(glow, 4, 0.5)
        out.ellipse_(c + 0.6, c + 0.8, d / 2 - 2.8, d / 2 - 2.8, gr[3])
    else:
        out.px_(int(c + 1), int(c - 2), R['glass'][3])
    out.rect_(int(c), 2, 1, d - 2, fc[1])
    out.rect_(2, int(c), d - 2, 1, fc[1])
    return out


def lintel(img: Img, x: int, y: int, w: int, mat: str = 'brick') -> None:
    """A soldier course of bricks (or a concrete beam) over an opening."""
    if mat == 'brick':
        c = P['brick']
        img.rect_(x - 2, y - 4, w + 4, 4, '#4a3a34')
        for xx in range(x - 2, x + w + 2, 3):
            img.rect_(xx, y - 4, 2, 3, c[3]); img.px_(xx, y - 4, c[4])
    else:
        img.rect_(x - 2, y - 3, w + 4, 3, P['concrete'][3])
        img.rect_(x - 2, y - 3, w + 4, 1, P['concrete'][4])
        img.rect_(x - 2, y - 1, w + 4, 1, P['concrete'][1])


def doorway(w: int, h: int, glow: str | None = None, inside: str | None = None, arch: bool = False,
            frame: str = 'wood', step: bool = True, seed: int = 1) -> Img:
    """An open doorway: casing, the room behind it receding (back wall, floor), a light spill
    across the threshold (glow) and, optionally, something inside: 'hearth' (a brick forge with
    its fire, lighting the floor), 'shelves', 'cage' (a lift car's lattice). The opening is what
    reads as 'enter here'."""
    out = Img.new(w, h)
    fc = {'wood': P['wood'], 'stone': P['stone'], 'iron': R['steel'], 'white': R['white'],
          'concrete': P['concrete']}[frame]
    out.rect_(0, 0, w, h, fc[3])
    out.rect_(0, 0, w, 1, fc[4]); out.rect_(0, 0, 1, h, fc[4])
    out.rect_(w - 1, 0, 1, h, fc[1])
    ix0, iy0, ix1, iy1 = 2, 2, w - 2, h - (3 if step else 0)
    iw = ix1 - ix0
    dark = ['#0b0809', '#140f10', '#1d1616', '#2a201d']
    out.rect_(ix0, iy0, iw, iy1 - iy0, dark[1])
    fy = iy0 + (iy1 - iy0) * 11 // 20            # where the back wall meets the floor
    out.rect_(ix0, iy0, iw, fy - iy0, dark[2])
    out.rect_(ix0, fy, iw, iy1 - fy, dark[0])
    out.rect_(ix0, iy0, iw, 2, dark[0])           # under the lintel
    out.rect_(ix0, iy0, 2, iy1 - iy0, dark[0])    # the left reveal in shade
    cx = ix0 + iw // 2
    if inside == 'hearth':
        f = P['fire']
        hw, hh = max(8, iw * 11 // 20), max(6, (fy - iy0) * 3 // 4)
        hx, hy = cx - hw // 2, fy - hh
        # warm light on the back wall and the floor
        out.ellipse_(cx, fy - 1, iw * 0.55, (fy - iy0) * 0.8, '#3a2016')
        out.poly_([(hx - 1, fy), (hx + hw + 1, fy), (ix1, iy1), (ix0, iy1)], '#2e1a12')
        out.poly_([(hx + 2, fy), (hx + hw - 2, fy), (cx + iw * 0.3, iy1), (cx - iw * 0.3, iy1)], '#4a2616')
        b = P['brick']
        out.rect_(hx, hy, hw, hh, b[1])
        for yy in range(hy, fy, 3):
            for xx in range(hx + (yy // 3) % 2 * 2, hx + hw, 4):
                out.rect_(xx, yy, 3, 2, b[2])
        out.rect_(hx - 1, hy - 1, hw + 2, 2, b[3])
        mw = hw - 6
        out.rect_(hx + 3, hy + 3, mw, hh - 3, '#1a0b08')
        out.rect_(hx + 3, hy + hh - 3, mw, 2, f[2])
        for i, xx in enumerate(range(hx + 4, hx + 3 + mw - 1, 2)):
            th = [3, 5, 2, 4, 3][i % 5]
            out.rect_(xx, hy + hh - 2 - th, 1, th, f[3])
            out.px_(xx, hy + hh - 3, f[4])
        out.rect_(hx + 3, hy + hh - 1, mw, 1, f[5])
    elif inside == 'shelves':
        wd = P['woodgrey']
        for yy in range(iy0 + 4, fy, 5):
            out.rect_(ix0 + 2, yy, iw - 4, 1, wd[1])
            for xx in range(ix0 + 3, ix1 - 3, 4):
                out.rect_(xx, yy - 3, 3, 3, [wd[0], '#3a2c22', '#2c3328'][(xx + yy) % 3])
    elif inside == 'mine':
        # a hall running back: rails converging on the lit cage at the far end, a lamp overhead
        st = R['steel']
        vx, vy = cx, fy - 2
        out.rect_(vx - 4, iy0 + 5, 9, vy - iy0 - 4, '#3a2c1e')
        out.rect_(vx - 3, iy0 + 6, 7, vy - iy0 - 6, '#6b4f2a')
        for yy in range(iy0 + 7, vy, 2):
            out.rect_(vx - 3, yy, 7, 1, '#2a2016')
        for yy in range(fy, iy1):
            k = (yy - fy) / max(1, iy1 - fy)
            half = 2 + k * (iw * 0.34)
            if (yy - fy) % 3 == 1:
                out.rect_(int(cx - half - 2), yy, int(2 * half + 5), 1, '#2c2118')
            out.px_(int(cx - half), yy, st[3]); out.px_(int(cx + half), yy, st[3])
        out.rect_(cx, iy0 + 2, 1, 3, '#2a2426')
        out.rect_(cx - 2, iy0 + 5, 5, 1, R['tin'][3] if 'tin' in R else P['tin'][3])
        out.px_(cx, iy0 + 6, '#fff1c2')
        out.ellipse_(cx, fy + (iy1 - fy) * 0.4, iw * 0.28, (iy1 - fy) * 0.35, '#3a2a18', 0.6)
    elif inside == 'heat':
        # a heat lamp under a tin shade hanging over straw: the kennel's red-orange warmth
        st = P['straw']
        out.ellipse_(cx, iy0 + 9, iw * 0.45, (iy1 - iy0) * 0.55, '#3a1a12')
        out.rect_(ix0, fy, iw, iy1 - fy, '#2a1a10')
        for xx in range(ix0 + 1, ix1 - 1, 2):
            out.px_(xx, fy + (xx * 7) % max(1, iy1 - fy), st[1])
            out.px_(xx + 1, iy1 - 2 - (xx * 3) % 3, st[2])
        out.rect_(cx, iy0 + 1, 1, 4, '#2a2426')
        out.poly_([(cx - 3, iy0 + 5), (cx + 3, iy0 + 5), (cx + 5, iy0 + 9), (cx - 5, iy0 + 9)], '#5a4a3a')
        out.rect_(cx - 2, iy0 + 9, 5, 2, '#ff6a3a'); out.px_(cx, iy0 + 9, '#ffd0a0')
    elif inside == 'cage':
        st = R['steel']
        out.rect_(ix0 + 2, iy0 + 2, iw - 4, iy1 - iy0 - 2, '#171a1e')
        for xx in range(ix0 + 3, ix1 - 2, 3):
            out.rect_(xx, iy0 + 2, 1, iy1 - iy0 - 2, st[1])
        out.rect_(ix0 + 2, fy - 2, iw - 4, 1, st[2])
    if glow:
        gr = ramp(glow, 4, 0.5)
        for i in range(4):
            yy = iy1 - 1 - i
            out.rect_(ix0 + i, yy, iw - 2 * i, 1, gr[3 - min(3, i)], 0.85 - i * 0.2)
    if arch:
        for x in range(w):
            k = abs(x - (w - 1) / 2) / ((w - 1) / 2)
            cut = int(round((1 - math.sqrt(max(0, 1 - k * k))) * min(8, w / 3)))
            if cut:
                out.a[:cut, x] = 0
    out = ink(out)
    if step:
        st = P['stone']
        out.rect_(0, h - 3, w, 3, st[2]); out.rect_(0, h - 3, w, 1, st[4]); out.rect_(0, h - 1, w, 1, INK)
        out.rect_(0, h - 3, 1, 3, INK); out.rect_(w - 1, h - 3, 1, 3, INK)
        if glow:
            out.rect_(2, h - 3, w - 4, 1, mix(st[4], glow, 0.5))
    return out


def plank_door(w: int, h: int, tone: str = 'wood', ajar: float = 0.0, glow: str | None = None,
               step: bool = True, brace: bool = True, window_: bool = False) -> Img:
    """A plank door on strap hinges in its casing. ajar > 0 swings the leaf in and shows the lit
    room behind — that is what makes a shut-looking wall an entrance."""
    c = rp(tone)
    out = Img.new(w, h)
    fc = P['wood']
    out.rect_(0, 0, w, h, fc[1])
    out.rect_(0, 0, w, 1, fc[3]); out.rect_(0, 0, 1, h, fc[3])
    ix0, iy0, ix1, iy1 = 2, 2, w - 2, h - (3 if step else 0)
    lw = ix1 - ix0
    open_w = int(round(lw * ajar))
    if open_w:
        fy = iy0 + (iy1 - iy0) * 11 // 20
        out.rect_(ix0, iy0, open_w, iy1 - iy0, '#1d1616')
        out.rect_(ix0, fy, open_w, iy1 - fy, '#0f0b0b')
        if glow:
            gr = ramp(glow, 4, 0.5)
            out.rect_(ix0, iy0 + 2, open_w, fy - iy0 - 2, mix('#1d1616', gr[1], 0.35))
            for i in range(3):
                out.rect_(ix0, iy1 - 1 - i, open_w, 1, gr[3 - i], 0.85 - i * 0.22)
            out.rect_(ix0 + open_w - 1, iy0 + 1, 1, iy1 - iy0 - 1, gr[2], 0.5)
    lx0 = ix0 + open_w
    # the leaf (narrower when swung in: it is seen at an angle)
    for i, x in enumerate(range(lx0, ix1)):
        k = (x - lx0) % 4
        col = c[[3, 2, 2, 1][k]]
        out.rect_(x, iy0, 1, iy1 - iy0, col)
    if brace and ix1 - lx0 > 5:
        for y in (iy0 + 3, iy1 - 5):
            out.rect_(lx0, y, ix1 - lx0, 2, c[1]); out.rect_(lx0, y, ix1 - lx0, 1, c[3])
        out.line_(lx0 + 1, iy1 - 4, ix1 - 2, iy0 + 5, c[1])
    ir = R['steel']
    if ix1 - lx0 > 4:
        for y in (iy0 + 4, iy1 - 4):                                # strap hinges
            out.rect_(ix1 - min(8, ix1 - lx0), y, min(8, ix1 - lx0), 1, ir[1])
            out.px_(ix1 - 3, y, ir[3])
        out.rect_(lx0 + 1, iy0 + (iy1 - iy0) // 2, 2, 2, ir[3])     # the ring handle
        out.px_(lx0 + 1, iy0 + (iy1 - iy0) // 2 + 2, ir[1])
    if window_ and ix1 - lx0 > 6:
        wx, wy = lx0 + 2, iy0 + 3
        out.rect_(wx, wy, ix1 - lx0 - 4, 5, R['glass'][1]); out.px_(wx + 1, wy + 1, R['glass'][3])
    out = ink(out)
    if step:
        st = P['stone']
        out.rect_(0, h - 3, w, 3, st[2]); out.rect_(0, h - 3, w, 1, st[4]); out.rect_(0, h - 1, w, 1, INK)
        out.rect_(0, h - 3, 1, 3, INK); out.rect_(w - 1, h - 3, 1, 3, INK)
        if glow and open_w:
            out.rect_(2, h - 3, open_w + 1, 1, mix(st[4], glow, 0.6))
    return out


# ---------------------------------------------------------------------------- fittings
def dormer(img: Img, cx: int, yb: int, w: int, face: int, kind: str, up: int, seed: int = 1,
           vent: str = 'louver') -> None:
    """A small front-gabled dormer on a front slope: its face (planks, a louvered vent or a little
    window) stands at yb, its two roof slopes run back into the main roof (the valleys)."""
    half = w // 2
    xl, xr = cx - half, cx + half
    rise = int(half * 0.6)
    ya = yb - face - rise
    c = ROOF_EDGE[kind]
    lt = courses(kind, up + rise + face, half + 2, seed).rot90(1)
    fill_poly(img, [(xl - 2, yb - face + 1), (cx, ya), (cx, ya - up), (xl - 2, yb - face + 1 - up // 3)], lt.mul(1.12), xl - 2, ya - up)
    fill_poly(img, [(xr + 2, yb - face + 1), (cx, ya), (cx, ya - up), (xr + 2, yb - face + 1 - up // 3)], lt.flip().mul(0.78), cx, ya - up)
    img.rect_(cx, ya - up, 1, up, c[4])
    fm = fill_poly(img, [(xl, yb), (xl, yb - face), (cx, ya + 2), (xr, yb - face), (xr, yb)],
                   wall('plankgrey', w + 1, face + rise + 2, seed), xl, ya)
    edge(img, fm, INK, 'lrb')
    if vent == 'louver':
        vx, vy, vw, vh = cx - 4, yb - face - 2, 9, face
        img.rect_(vx, vy, vw, vh, '#1a1512')
        for y in range(vy + 1, vy + vh, 2):
            img.rect_(vx, y, vw, 1, P['woodgrey'][2])
    else:
        vx, vy = cx - 4, yb - face - 1
        img.rect_(vx, vy, 9, face - 1, R['glass'][1]); img.px_(vx + 6, vy + 1, R['glass'][3])
        img.rect_(cx, vy, 1, face - 1, R['white'][3])
    img.rect_(vx - 1, vy - 1, vw + 2 if vent == 'louver' else 11, 1, INK)
    wd = P['wood']
    img.line_(xl - 2, yb - face + 1, cx, ya, wd[3]); img.line_(xr + 2, yb - face + 1, cx, ya, wd[2])
    img.line_(xl - 2, yb - face + 2, cx, ya + 1, INK); img.line_(xr + 2, yb - face + 2, cx, ya + 1, INK)
    img.line_(xl - 2, yb - face, cx, ya - 1, INK); img.line_(xr + 2, yb - face, cx, ya - 1, INK)
    img.line_(xl - 2, yb - face + 1 - up // 3, cx, ya - up, INK)
    img.line_(xr + 2, yb - face + 1 - up // 3, cx, ya - up, INK)


def monitor(img: Img, x0: int, x1: int, yb: int, face: int, depth: int, kind: str, seed: int = 1,
            glass: bool = False) -> None:
    """A roof monitor (a raised clerestory along the ridge): a louvred or glazed face standing on
    the roof at yb, its own low roof `depth` px deep on top — the boiler house breathes through it."""
    w = x1 - x0
    wd = P['woodgrey']
    img.rect_(x0, yb - face, w, face, wd[1])
    for x in range(x0 + 1, x1 - 1, 6 if glass else 3):
        if glass:
            img.rect_(x, yb - face + 1, 5, face - 2, R['glass'][2]); img.px_(x + 3, yb - face + 1, R['glass'][4])
        else:
            img.rect_(x, yb - face + 1, 2, face - 2, '#1a1512'); img.rect_(x, yb - face + 1, 2, 1, wd[3])
    img.rect_(x0, yb - face, 1, face, INK); img.rect_(x1 - 1, yb - face, 1, face, INK)
    img.rect_(x0, yb, w, 1, INK)
    top = courses(kind, w + 4, depth, seed)
    img.paste_(top.mul(1.06), x0 - 2, yb - face - depth + 1)
    c = ROOF_EDGE[kind]
    img.rect_(x0 - 2, yb - face - 1, w + 4, 2, c[1]); img.rect_(x0 - 2, yb - face - 1, w + 4, 1, c[3])
    img.rect_(x0 - 2, yb - face + 1, w + 4, 1, INK)
    img.rect_(x0 - 2, yb - face - depth, w + 4, 1, INK)
    img.rect_(x0 - 2, yb - face - depth, 1, depth + 2, INK); img.rect_(x1 + 1, yb - face - depth, 1, depth + 2, INK)


def moss(img: Img, x0: int, y0: int, x1: int, y1: int, seed: int = 1, n: int = 12) -> None:
    """Moss and lichen in clumps on a roof region (only on opaque, non-ink pixels)."""
    r = rng('moss', x0, y0, seed)
    ink_ = np.array(hexrgb(INK)[:3])
    cols = ['#56643a', '#6f7d44', '#8f9a4a']
    for _ in range(n):
        cx, cy = r.randrange(x0, x1), r.randrange(y0, y1)
        for k in range(r.randrange(3, 8)):
            x, y = cx + r.randrange(-3, 4), cy + r.randrange(-1, 2)
            if 0 <= x < img.w and 0 <= y < img.h and img.a[y, x, 3] > 0 and not np.array_equal(img.a[y, x, :3], ink_):
                img.px_(x, y, cols[min(2, k % 3)])


def soot_trail(img: Img, x: int, y: int, dx: float, n: int, seed: int = 1) -> None:
    """Soot washed down a roof from a chimney: dark pixels thinning out along (dx, 1)."""
    r = rng('soot', x, y, seed)
    for i in range(n):
        k = 1 - i / n
        for j in range(3):
            px = int(x + dx * i + r.randrange(-2, 3))
            py = int(y + i)
            if 0 <= px < img.w and 0 <= py < img.h and img.a[py, px, 3] > 0 and r.random() < k:
                img.px_(px, py, '#141012', 0.35 * k + 0.1)


def weathervane(kind: str = 'arrow') -> Img:
    """A little iron weathervane on a spike: an arrow, or a dog for the kennel. 11 × 14."""
    from lib import grid
    st = R['steel']
    if kind == 'dog':
        g = ['.....k.....', '....kkk....', '.kk.kkkk...', 'kkkkkkkk...', '.kkkkkkk...', '.k.k.k.k...',
             '.....k.....', '...kkkkk...', '.....k.....', '.....k.....', '.....k.....', '.....k.....',
             '.....k.....', '....kkk....']
    else:
        g = ['...........', '.....k.....', 'kk..kkk....', 'kkkkkkkkkkk', 'kk..kkk....', '.....k.....',
             '.....k.....', '...kkkkk...', '.....k.....', '.....k.....', '.....k.....', '.....k.....',
             '.....k.....', '....kkk....']
    out = grid(g, {'k': st[3]})
    out.a[:3, :, :3] = np.where(out.a[:3, :, 3:4] > 0, np.array(hexrgb(st[4])[:3], np.uint8), out.a[:3, :, :3])
    return out


def cupola(w: int = 14, h: int = 10) -> Img:
    """A barn's ventilation cupola: a louvred box under a little pyramid cap."""
    wd = P['wood']
    out = Img.new(w, h + 8)
    out.rect_(1, 8, w - 2, h, A_BARN[2])
    for y in range(10, 8 + h - 1, 2):
        out.rect_(3, y, w - 6, 1, '#1a1210')
    out.rect_(1, 8, 1, h, A_BARN[3])
    out.poly_([(0, 9), (w / 2, 0), (w, 9)], P['woodgrey'][2])
    out.poly_([(0, 9), (w / 2, 0), (w / 2, 9)], P['woodgrey'][3])
    out.rect_(0, 8, w, 1, P['woodgrey'][1])
    return outline(out, INK).crop(1, 1, w, h + 8)


A_BARN = ['#3c1d19', '#5a2a22', '#7a3a2c', '#95513a', '#b0704f']


def canopy(w: int, depth: int = 7, kind: str = 'galv', seed: int = 1) -> Img:
    """A door canopy (козырёк) on two wooden brackets: a little shed roof sticking out of the wall.
    Its sprite: the roof seen from above (depth px) and the brackets under it."""
    c = ROOF_EDGE[kind]
    out = Img.new(w, depth + 8)
    top = courses(kind, w, depth, seed)
    out.paste_(top.mul(1.05), 0, 0)
    out.rect_(0, depth - 2, w, 2, c[1]); out.rect_(0, depth - 2, w, 1, c[3])
    wd = P['wood']
    for x in (2, w - 5):
        out.rect_(x, depth, 3, 2, wd[2])
        out.line_(x + 1, depth + 7, x + (3 if x < w // 2 else -1), depth + 2, wd[1])
        out.rect_(x + 1, depth, 1, 8, wd[3])
    out = outline(out, INK).crop(1, 1, w, depth + 8)
    out.rect_(0, depth, w, 1, INK)
    return out


def firewood(w: int = 26, h: int = 16, seed: int = 1) -> Img:
    """A stack of split firewood (поленница) against the wall: log ends in rows, a tin sheet on top."""
    r = rng('wood', w, h, seed)
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(0, 3, w, h - 3, wd[0])
    for row, y in enumerate(range(h - 4, 2, -4)):
        for x in range(1 + (row % 2) * 2, w - 2, 4):
            k = r.choice([2, 3, 3, 4])
            out.rect_(x, y, 3, 3, wd[k]); out.px_(x + 1, y + 1, wd[k - 1] if k > 2 else wd[1])
            out.px_(x + 2, y + 2, wd[1])
    g = R['galv']
    out.rect_(0, 0, w, 3, g[2]); out.rect_(0, 0, w, 1, g[4])
    for x in range(1, w, 4):
        out.px_(x, 1, g[3])
    return outline(out, INK).crop(1, 1, w, h)


def bench(w: int = 22) -> Img:
    wd = P['woodgrey']
    out = Img.new(w, 8)
    out.rect_(0, 2, w, 2, wd[3]); out.rect_(0, 2, w, 1, wd[4])
    out.rect_(0, 4, w, 1, wd[1])
    for x in (2, w - 4):
        out.rect_(x, 5, 2, 3, wd[1])
    return outline(out, INK).crop(1, 1, w, 8)


def roof_ladder(h: int) -> Img:
    """A roof ladder laid on a slope (for the stove pipes): two rails, rungs."""
    wd = P['woodgrey']
    out = Img.new(8, h)
    out.rect_(0, 0, 2, h, wd[3]); out.rect_(6, 0, 2, h, wd[2])
    for y in range(2, h, 4):
        out.rect_(1, y, 6, 1, wd[3]); out.rect_(1, y + 1, 6, 1, INK)
    out.rect_(0, 0, 1, h, INK); out.rect_(7, 0, 1, h, INK)
    return out


def horseshoe() -> Img:
    """An iron horseshoe nailed ends-up over a smithy's door (for luck), 9 × 8."""
    from lib import grid
    g = [
        '.kk...kk.',
        'k43k.k32k',
        'k4k...k2k',
        'k4k...k2k',
        'k43k.k21k',
        '.k43k321k',
        '..k4321k.',
        '...kkkk..',
    ]
    st = R['steel']
    return grid(g, {'k': INK, '1': st[1], '2': st[2], '3': st[3], '4': st[4]})


def sign(s: str, bg: str = '#3f2e24', fg: str = '#f2c46a', pad: int = 3, border: str | None = None,
         shadow: str | None = '#1a1212') -> Img:
    t = text(s, fg, shadow)
    w, h = t.w + pad * 2, t.h + pad * 2 - (1 if shadow else 0) + 1
    out = Img.new(w, h)
    b = ramp(bg, 4, 0.4)
    out.rect_(0, 0, w, h, bg)
    out.rect_(0, 0, w, 1, b[3]); out.rect_(0, h - 1, w, 1, b[0])
    if border:
        out.rect_(1, 1, w - 2, 1, border); out.rect_(1, h - 2, w - 2, 1, border)
        out.rect_(1, 1, 1, h - 2, border); out.rect_(w - 2, 1, 1, h - 2, border)
    out.paste_(t, pad, pad)
    out = ink(out)
    return out


def wall_lamp(kind: str = 'enamel') -> tuple[Img, tuple[int, int]]:
    """A lamp on a bracket arm over a door: iron arm, an enamel shade, a bright bulb.
    Returns the sprite and the bulb's position in it."""
    ir = R['steel']
    out = Img.new(12, 12)
    out.rect_(0, 2, 2, 5, ir[2]); out.rect_(0, 2, 1, 5, ir[3])            # wall plate
    out.rect_(1, 3, 6, 1, ir[2]); out.line_(1, 6, 5, 3, ir[1])            # arm and strut
    sh = ['#2f4a3e', '#4a6f5d', '#6f9a82'] if kind == 'enamel' else [ir[1], ir[2], ir[3]]
    out.poly_([(5, 4), (9, 4), (12, 8), (2, 8)], sh[1])
    out.rect_(5, 4, 4, 1, sh[2]); out.rect_(2, 7, 10, 1, sh[0])
    out = outline(out.crop(0, 0, 12, 9), INK).crop(1, 1, 12, 12)
    out.rect_(5, 7, 3, 2, '#fff4c8'); out.px_(6, 9, '#ffe08a')
    return out, (6, 8)


def downpipe(h: int, tone: str = 'galv') -> Img:
    c = rp(tone)
    out = Img.new(6, h)
    out.rect_(0, 0, 6, 3, c[2]); out.rect_(0, 0, 6, 1, c[4])             # the funnel
    out.rect_(1, 3, 3, h - 5, c[2]); out.rect_(1, 3, 1, h - 5, c[3])
    for y in range(8, h - 4, 12):
        out.rect_(0, y, 5, 1, c[1])
    out.rect_(1, h - 2, 5, 2, c[2]); out.rect_(1, h - 2, 5, 1, c[3])     # the shoe
    return outline(out, INK)


def chimney(w: int, h: int, mat: str = 'brick', cap: bool = True, seed: int = 1, soot: bool = True) -> Img:
    """A brick chimney stack rising from a roof: lit left face, shaded right, a cap, soot on top."""
    out = Img.new(w, h)
    out.paste_(texture('brick' if mat == 'brick' else mat, w, h, seed), 0, 0)
    out.rect_(w * 2 // 3, 0, w - w * 2 // 3, h, '#000000', 0.25)          # side in shade
    if cap:
        out.rect_(0, 0, w, 3, P['concrete'][3]); out.rect_(0, 0, w, 1, P['concrete'][4])
        out.rect_(0, 3, w, 1, '#000000', 0.3)
    if soot:
        for y in range(3, min(h, 9)):
            out.rect_(0, y, w, 1, '#141012', 0.45 * (1 - (y - 3) / 6))
    out = ink(out)
    out.rect_(2, 1, w - 4, 1, '#0c0a0a')                                   # the flue
    return out


def roof_stack(img: Img, x: int, w: int, top: int, base_l: int, base_r: int, mat: str = 'brick',
               seed: int = 1, cap: bool = True, soot: bool = True) -> None:
    """A chimney stack standing ON a roof: drawn from `top` down to the roof surface, whose line runs
    from base_l (at x) to base_r (at x+w-1) — level on a front slope, slanted on a side slope.
    Lit left face, shaded right third, soot at the mouth, tin flashing where it meets the roof."""
    hmax = max(base_l, base_r) - top + 2
    col = texture(mat, w, hmax, seed)
    col.rect_(w * 2 // 3, 0, w - w * 2 // 3, hmax, '#000000', 0.28)
    col.rect_(0, 0, 1, hmax, '#ffffff', 0.12)
    if soot:
        for y in range(0, 8):
            col.rect_(0, y + 3, w, 1, '#141012', 0.5 * (1 - y / 8))
    def base_at(xx):
        return base_l + (base_r - base_l) * xx / max(1, w - 1) - top
    for xx in range(w):
        col.a[int(round(base_at(xx))) + 1:, xx] = 0
    col = ink(col)
    g = R['galv']
    for xx in range(1, w - 1):
        b = int(round(base_at(xx)))
        col.px_(xx, b - 1, g[3]); col.px_(xx, b - 2, g[2]); col.px_(xx, b - 3, g[1])
    img.paste_(col, x, top)
    if cap:
        img.rect_(x - 1, top, w + 2, 3, P['concrete'][3])
        img.rect_(x - 1, top, w + 2, 1, P['concrete'][4])
        img.rect_(x - 1, top + 2, w + 2, 1, P['concrete'][1])
        img.rect_(x - 2, top - 1, w + 4, 1, INK); img.rect_(x - 2, top + 3, w + 4, 1, INK)
        img.rect_(x - 2, top - 1, 1, 5, INK); img.rect_(x + w + 1, top - 1, 1, 5, INK)
        img.rect_(x + 2, top + 1, w - 4, 1, '#0c0a0a')
    # the roof in the stack's shadow (light from the upper left: shadow to the right)
    for xx in range(w, w + 4):
        b = int(round(base_l + (base_r - base_l) * xx / max(1, w - 1)))
        img.rect_(x + xx, b - (hmax - 2) // 3, 1, (hmax - 2) // 3 + 1, '#000000', 0.22 - (xx - w) * 0.04)


def stovepipe(h: int, bend: int = 0, tone: str = 'steel') -> Img:
    """A tin stovepipe with a conical rain cap on three stays; bend kinks it (crooked, for the
    tower). The sprite's bottom row is where it goes into the roof."""
    c = rp(tone)
    w = 11 + abs(bend)
    out = Img.new(w, h)
    x0 = 3 + max(0, -bend)
    x = x0
    for y in range(h - 1, 5, -1):
        if bend and y < h * 0.55:
            x = x0 + int(round(bend * min(1, (h * 0.55 - y) / 5)))
        out.rect_(x, y, 4, 1, c[2]); out.px_(x, y, c[3]); out.px_(x + 3, y, c[1])
        if y % 7 == 0:
            out.rect_(x - 1, y, 6, 1, c[1]); out.px_(x - 1, y, c[3])
    # cap: a flat cone held above the mouth
    out.rect_(x, 4, 1, 2, c[1]); out.rect_(x + 3, 4, 1, 2, c[1])
    out.poly_([(x - 3, 4), (x + 2, 0), (x + 7, 4)], c[3])
    out.rect_(x - 3, 3, 10, 1, c[2])
    out.px_(x + 1, 1, c[4]); out.px_(x, 2, c[4])
    out.rect_(x, 5, 4, 1, '#0c0a0a')
    return outline(out, INK).crop(0, 0, w + 2, h + 1)


def poster(w: int, h: int, seed: int = 1, style: str = 'text') -> Img:
    """A pasted poster: paper, a picture band, lines of text, a torn corner."""
    r = rng('poster', w, h, seed, style)
    pp = P['paper']
    out = Img.new(w, h)
    base = r.choice([pp[3], pp[2], '#d9c7a2'])
    out.rect_(0, 0, w, h, base)
    accent = r.choice([P['red'][2], '#3d5f8c', P['green'][2], '#c2952a'])
    if style == 'star':
        out.rect_(1, 1, w - 2, h // 2, accent)
        out.px_(w // 2, 2, pp[3]); out.rect_(w // 2 - 1, 3, 3, 1, pp[3]); out.px_(w // 2, 4, pp[3])
    elif style == 'figure':
        out.rect_(1, 1, w - 2, h // 2 + 1, accent)
        out.rect_(w // 2 - 1, 2, 2, 2, pp[3]); out.rect_(w // 2 - 2, 4, 4, h // 2 - 3, pp[3])
    else:
        out.rect_(1, 1, w - 2, 2, accent)
    for y in range(h // 2 + 2 if style != 'text' else 4, h - 1, 2):
        out.rect_(1, y, r.randrange(max(2, w - 5), w - 1), 1, pp[0])
    out.rect_(0, h - 1, w, 1, pp[1])
    out = ink(out)
    if r.random() < 0.6:
        out.a[h - 2:h, w - 2:w] = 0
        out.px_(w - 2, h - 2, pp[1])
    return out


def rail_track(w: int, h: int = 16) -> Img:
    """A short stretch of rails running toward the viewer: sleepers across, two rails."""
    out = Img.new(w, h)
    wd = P['woodgrey']
    for y in range(1, h, 4):
        out.rect_(0, y, w, 3, wd[1]); out.rect_(0, y, w, 1, wd[3])
        out.rect_(0, y + 2, w, 1, INK)
    st = R['steel']
    for x in (2, w - 5):
        out.rect_(x, 0, 3, h, st[2]); out.rect_(x, 0, 1, h, st[4]); out.rect_(x + 2, 0, 1, h, st[0])
    return out


def cage(w: int = 22, h: int = 18, seed: int = 1, occupant: str | None = None) -> Img:
    """A wire-mesh cage on a plank base (the kennel's), straw inside, a bowl, maybe a pup."""
    r = rng('cage', w, h, seed)
    out = Img.new(w, h)
    wd, ir = P['wood'], R['galv']
    out.rect_(0, 0, w, h - 3, '#1e1714')
    st = P['straw']
    for _ in range(w * 2):
        out.px_(r.randrange(1, w - 1), r.randrange(h - 8, h - 3), st[r.randrange(1, 4)])
    if occupant == 'pup':
        pc = ['#5c4030', '#8a6446', '#b08a62']
        out.ellipse_(w * 0.45, h - 7, 5, 3, pc[1]); out.ellipse_(w * 0.45 - 0.5, h - 7.5, 4, 2, pc[2])
        out.ellipse_(w * 0.45 + 5, h - 9, 3, 2.6, pc[1])
        out.px_(int(w * 0.45 + 6), h - 10, INK); out.px_(int(w * 0.45 + 8), h - 9, INK)
        out.rect_(int(w * 0.45 + 3), h - 12, 2, 2, pc[0])
    out.ellipse_(w - 5, h - 5, 3, 1.4, R['steel'][3])
    for x in range(0, w, 3):                                     # mesh
        out.rect_(x, 0, 1, h - 3, ir[3], 0.85)
    for y in range(1, h - 3, 3):
        out.rect_(0, y, w, 1, ir[2], 0.7)
    out.rect_(0, 0, w, 2, wd[3]); out.rect_(0, 0, w, 1, wd[4])
    out.rect_(0, h - 3, w, 3, wd[2]); out.rect_(0, h - 3, w, 1, wd[3])
    out.rect_(0, 0, 2, h, wd[2]); out.rect_(w - 2, 0, 2, h, wd[1])
    return ink(out)


def tyre(w: int = 16) -> Img:
    """A tyre lying flat, seen from above and in front: a treaded side band and the top ring with
    its hole (transparent, so what it lies on shows through)."""
    c = ['#141417', '#232328', '#34343b', '#4a4a53', '#62626c']
    h = w // 2 + 3
    out = Img.new(w, h)
    out.ellipse_(w / 2, h - 4, w / 2, w / 4, c[1])
    out.rect_(0, w // 4, w, 3, c[1])
    for x in range(1, w - 1, 2):
        out.px_(x, w // 4 + 2, c[0])
    out.ellipse_(w / 2, w / 4, w / 2, w / 4, c[2])
    out.ellipse_(w / 2 - 0.5, w / 4 - 0.5, w / 2 - 1, w / 4 - 1, c[3])
    out.ellipse_(w / 2, w / 4 + 0.4, w / 4, w / 8 + 0.6, c[0])
    out.rect_(2, w // 4 - 2, w // 3, 1, c[4])
    out = outline(out, INK)
    hole = Img.new(out.w, out.h)
    hole.ellipse_(w / 2 + 1, w / 4 + 1.6, w / 4 - 1.2, w / 8 - 0.4, '#ffffff')
    out.a[hole.a[:, :, 3] > 0, 3] = 0
    return out.crop(1, 1, w, h)


def tyre_stack(n: int = 3) -> Img:
    t = tyre(16)
    out = Img.new(16, t.h + (n - 1) * 4)
    for i in range(n):
        out.paste_(t, 0, out.h - t.h - i * 4)
    return out


def fuel_drum(color: str = '#4a6b52') -> Img:
    c = ramp(color, 5, 0.5)
    out = Img.new(12, 16)
    for x in range(12):
        col = c[3] if x < 3 else (c[2] if x < 8 else c[1])
        out.rect_(x, 2, 1, 13, col)
    for y in (6, 11):
        out.rect_(0, y, 12, 1, c[0]); out.rect_(0, y - 1, 12, 1, c[4])
    out.ellipse_(6, 2.5, 6, 2.5, c[4]); out.ellipse_(6, 2.5, 4.5, 1.6, c[3])
    out.px_(4, 2, c[0])
    out.rect_(1, 8, 4, 2, P['rust'][2], 0.8)
    return outline(out, INK)


def pallet_stack(w: int = 20, n: int = 3) -> Img:
    out = Img.new(w, n * 4 + 1)
    wd = P['woodgrey']
    for i in range(n):
        y = out.h - 5 - i * 4
        out.rect_(0, y, w, 2, wd[3]); out.rect_(0, y, w, 1, wd[4])
        for x in (0, w // 2 - 1, w - 3):
            out.rect_(x, y + 2, 3, 2, wd[1])
    return outline(out, INK)


# ------------------------------------------------------------------ a 5×7 sign font
# kit.text is 3×5 and its Ш, Ц, И, Н are too close to read on a facade ("ШАХТА" read "ЧАХТА",
# "КУЗНИЦА" read "КУЗНИЧА"). Facade signs use this one: capitals, digits, a few signs.
_G = {
    'А': '.###.|#...#|#...#|#####|#...#|#...#|#...#', 'Б': '#####|#....|#....|####.|#...#|#...#|####.',
    'В': '####.|#...#|#...#|####.|#...#|#...#|####.', 'Г': '#####|#....|#....|#....|#....|#....|#....',
    'Д': '..##.|.#.#.|.#.#.|.#.#.|.#.#.|#####|#...#', 'Е': '#####|#....|#....|####.|#....|#....|#####',
    'Ё': '.#.#.|#####|#....|####.|#....|#....|#####', 'Ж': '#.#.#|#.#.#|.###.|..#..|.###.|#.#.#|#.#.#',
    'З': '.###.|#...#|....#|..##.|....#|#...#|.###.', 'И': '#...#|#...#|#..##|#.#.#|##..#|#...#|#...#',
    'Й': '.#.#.|#...#|#..##|#.#.#|##..#|#...#|#...#', 'К': '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
    'Л': '..###|.#..#|.#..#|.#..#|.#..#|.#..#|#...#', 'М': '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
    'Н': '#...#|#...#|#...#|#####|#...#|#...#|#...#', 'О': '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
    'П': '#####|#...#|#...#|#...#|#...#|#...#|#...#', 'Р': '####.|#...#|#...#|####.|#....|#....|#....',
    'С': '.###.|#...#|#....|#....|#....|#...#|.###.', 'Т': '#####|..#..|..#..|..#..|..#..|..#..|..#..',
    'У': '#...#|#...#|#...#|.####|....#|#...#|.###.', 'Ф': '..#..|.###.|#.#.#|#.#.#|.###.|..#..|..#..',
    'Х': '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#', 'Ц': '#..#.|#..#.|#..#.|#..#.|#..#.|#####|....#',
    'Ч': '#...#|#...#|#...#|.####|....#|....#|....#', 'Ш': '#.#.#|#.#.#|#.#.#|#.#.#|#.#.#|#.#.#|#####',
    'Щ': '#.#.#.|#.#.#.|#.#.#.|#.#.#.|#.#.#.|######|.....#', 'Ъ': '##...|.#...|.#...|.###.|.#..#|.#..#|.###.',
    'Ы': '#...#|#...#|#...#|###.#|#.#.#|#.#.#|###.#', 'Ь': '#....|#....|#....|####.|#...#|#...#|####.',
    'Э': '.###.|#...#|....#|..###|....#|#...#|.###.', 'Ю': '#..#.|#.#.#|#.#.#|###.#|#.#.#|#.#.#|#..#.',
    'Я': '.####|#...#|#...#|.####|..#.#|.#..#|#...#',
    '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
    '2': '.###.|#...#|....#|...#.|..#..|.#...|#####', '3': '#####|...#.|..#..|...#.|....#|#...#|.###.',
    '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', '5': '#####|#....|####.|....#|....#|#...#|.###.',
    '6': '..##.|.#...|#....|####.|#...#|#...#|.###.', '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
    '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.', '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
    '%': '##...|##..#|...#.|..#..|.#...|#..##|...##', '!': '#|#|#|#|#|.|#', '.': '.|.|.|.|.|.|#',
    '-': '...|...|...|###|...|...|...', ' ': '..|..|..|..|..|..|..', '№': '#..#..|##.#..|#.##.#|#..#.#|#..#.#|#..#..|#..#..',
}


def sign_text(s: str, color: str, shadow: str | None = '#1a1212', outline_: str | None = None) -> Img:
    """Text in the 5×7 facade font; `shadow` drops a 1 px shadow down-right, `outline_` rings it."""
    s = s.upper()
    glyphs = [_G.get(ch, _G[' ']).split('|') for ch in s]
    w = sum(len(g[0]) + 1 for g in glyphs) - 1
    pad = 1 if outline_ else 0
    out = Img.new(w + 1 + 2 * pad, 8 + 2 * pad)
    x = pad
    for g in glyphs:
        for yy, row in enumerate(g):
            for xx, v in enumerate(row):
                if v == '#':
                    if shadow:
                        out.px_(x + xx + 1, pad + yy + 1, shadow)
        x += len(g[0]) + 1
    x = pad
    for g in glyphs:
        for yy, row in enumerate(g):
            for xx, v in enumerate(row):
                if v == '#':
                    out.px_(x + xx, pad + yy, color)
        x += len(g[0]) + 1
    if outline_:
        m = out.a[:, :, 3] > 0
        grow = np.zeros_like(m)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            grow |= np.roll(np.roll(m, dy, 0), dx, 1)
        c = hexrgb(outline_)
        out.a[grow & ~m] = c
    return out


def board(s: str, bg: str = '#3f2e24', fg: str = '#f2c46a', pad: int = 3, frame: str | None = None,
          small: bool = False) -> Img:
    """A painted sign board: plank of `bg` with a lit top edge, letters in `fg`, an optional
    painted frame line, ink contour. small=True uses the 3×5 font (for short labels)."""
    r_, g_, b_, _ = hexrgb(bg)
    dark = (0.299 * r_ + 0.587 * g_ + 0.114 * b_) < 140
    sh = '#1a1212' if dark else None
    t = text(s, fg, sh) if small else sign_text(s, fg, sh)
    w, h = t.w + pad * 2 + 1, t.h + pad * 2
    out = Img.new(w, h)
    b = ramp(bg, 4, 0.4)
    out.rect_(0, 0, w, h, bg)
    out.rect_(0, 0, w, 1, b[3]); out.rect_(0, h - 1, w, 1, b[0])
    if frame:
        out.rect_(1, 1, w - 2, 1, frame); out.rect_(1, h - 2, w - 2, 1, frame)
        out.rect_(1, 1, 1, h - 2, frame); out.rect_(w - 2, 1, 1, h - 2, frame)
    out.paste_(t, pad + 1, pad)
    return ink(out)


# ----------------------------------------------------------------------- big structures
def big_text(s: str, color: str, shadow: str | None = '#1a1212', k: int = 2) -> Img:
    """The sign font at ×k (chunky letters for a landmark's sign)."""
    t = text(s, color, None).scale(k)
    if not shadow:
        return t
    out = Img.new(t.w + 1, t.h + 1)
    out.paste_(t.silhouette(shadow), 1, 1)
    out.paste_(t, 0, 0)
    return out


def sheave(r: int, frame: int, n: int = 4, spokes: int = 6) -> Img:
    """The headframe's sheave wheel facing the viewer: a grooved rim lit from the upper left, a hub,
    spokes turned by frame (a full cycle of n frames turns one spoke gap)."""
    st = R['steel']
    d = 2 * r + 3
    c = d / 2
    out = Img.new(d, d)
    out.ellipse_(c, c, r + 1, r + 1, INK)
    for y in range(d):
        for x in range(d):
            dx, dy = x + 0.5 - c, y + 0.5 - c
            rr = math.hypot(dx, dy)
            if r - 3 <= rr <= r:
                lit = (-dx - dy) / max(rr, 1e-6)                 # toward the upper left
                idx = 3 if lit > 0.5 else (2 if lit > -0.3 else 1)
                if r - 1.6 <= rr <= r - 0.6:
                    idx = max(0, idx - 1)                        # the groove the rope runs in
                out.px_(x, y, st[idx])
            elif rr < r - 3:
                out.a[y, x] = 0
    a0 = frame * (2 * math.pi / spokes) / n
    for i in range(spokes):
        a = a0 + i * 2 * math.pi / spokes
        x1, y1 = c + math.cos(a) * (r - 3), c + math.sin(a) * (r - 3)
        sx, sy = (1, 0) if abs(math.sin(a)) > 0.7 else (0, 1)
        out.line_(int(c) + sx, int(c) + sy, int(round(x1 - 0.5)) + sx, int(round(y1 - 0.5)) + sy, st[0])
        out.line_(int(c), int(c), int(round(x1 - 0.5)), int(round(y1 - 0.5)), st[3])
    out.ellipse_(c, c, 4, 4, INK)
    out.ellipse_(c - 0.3, c - 0.3, 3.2, 3.2, st[2])
    out.ellipse_(c - 0.8, c - 0.8, 1.8, 1.8, st[4])
    out.px_(int(c), int(c), st[0])
    # a painted mark on the rim makes the turn legible even where spokes blur
    a = a0 + 0.3
    out.px_(int(c + math.cos(a) * (r - 1.5)), int(c + math.sin(a) * (r - 1.5)), '#d0504f')
    return out


def girder(img: Img, x0: float, y0: float, x1: float, y1: float, w: int = 4, lit: bool = True) -> None:
    """A riveted steel member between two points: w px wide, light edge on the lit side."""
    st = R['steel']
    ln = math.hypot(x1 - x0, y1 - y0)
    nx, ny = -(y1 - y0) / ln, (x1 - x0) / ln
    hw = w / 2
    pts = [(x0 + nx * hw, y0 + ny * hw), (x1 + nx * hw, y1 + ny * hw), (x1 - nx * hw, y1 - ny * hw), (x0 - nx * hw, y0 - ny * hw)]
    img.poly_(pts, st[2])
    s = 1 if (nx + ny) < 0 else -1                   # the edge facing the upper left is lit
    ex0, ey0 = x0 + s * nx * (hw - 0.5), y0 + s * ny * (hw - 0.5)
    ex1, ey1 = x1 + s * nx * (hw - 0.5), y1 + s * ny * (hw - 0.5)
    img.line_(int(round(ex0)), int(round(ey0)), int(round(ex1)), int(round(ey1)), st[4] if lit else st[3])
    fx0, fy0 = x0 - s * nx * (hw - 0.5), y0 - s * ny * (hw - 0.5)
    fx1, fy1 = x1 - s * nx * (hw - 0.5), y1 - s * ny * (hw - 0.5)
    img.line_(int(round(fx0)), int(round(fy0)), int(round(fx1)), int(round(fy1)), st[0])
    for t in np.arange(0.12, 0.95, 7 / max(ln, 1)):
        img.px_(int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t)), st[3])


def truss(img: Img, x0: float, y0: float, x1: float, y1: float, depth: int = 7) -> None:
    """A lattice girder (two chords and a zigzag web) — the headframe's inclined back leg."""
    st = R['steel']
    ln = math.hypot(x1 - x0, y1 - y0)
    nx, ny = -(y1 - y0) / ln, (x1 - x0) / ln
    h = depth / 2
    a0 = (x0 + nx * h, y0 + ny * h); a1 = (x1 + nx * h, y1 + ny * h)
    b0 = (x0 - nx * h, y0 - ny * h); b1 = (x1 - nx * h, y1 - ny * h)
    steps = max(2, int(ln / depth))
    for i in range(steps):
        t0, t1 = i / steps, (i + 1) / steps
        pa = (a0[0] + (a1[0] - a0[0]) * t0, a0[1] + (a1[1] - a0[1]) * t0)
        pb = (b0[0] + (b1[0] - b0[0]) * t1, b0[1] + (b1[1] - b0[1]) * t1)
        img.line_(int(round(pa[0])), int(round(pa[1])), int(round(pb[0])), int(round(pb[1])), st[1])
        pc = (a0[0] + (a1[0] - a0[0]) * t1, a0[1] + (a1[1] - a0[1]) * t1)
        img.line_(int(round(pb[0])), int(round(pb[1])), int(round(pc[0])), int(round(pc[1])), st[2])
    girder(img, *a0, *a1, w=3)
    girder(img, *b0, *b1, w=3, lit=False)


def cable(img: Img, x0: float, y0: float, x1: float, y1: float) -> None:
    img.line_(int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1)), '#15181b')
    img.line_(int(round(x0)), int(round(y0)) - 1, int(round(x1)), int(round(y1)) - 1, R['steel'][2])


def cylinder(img: Img, cx: float, top: int, bot: int, r_top: float, r_bot: float, mat: str,
             ry: float = 0.0, seed: int = 1, tone: str | None = None, light: float = 1.0) -> None:
    """A vertical cylinder (a water tower shaft, a factory stack, a tank): the material wraps round
    it (courses squeeze toward the edges and follow the elliptic arcs), lit from the upper left.
    top/bot are the arcs' ends at the silhouette; the front arcs sag by ry·(r/r_top)."""
    rmax = max(r_top, r_bot)
    tw = int(math.pi * rmax) + 2
    th = bot - top + int(ry) + 4
    tex = wall(mat, tw, th, seed, tone) if mat not in ('tank',) else _tank_tex(tw, th, seed)
    for y in range(top, bot + int(ry) + 2):
        t = (y - top) / max(1, bot - top)
        r = r_top + (r_bot - r_top) * min(1, max(0, t))
        for x in range(int(cx - r), int(math.ceil(cx + r))):
            dx = (x + 0.5 - cx) / r
            if abs(dx) >= 1:
                continue
            sag = ry * (r / max(r_top, 1)) * math.sqrt(1 - dx * dx)
            if y < top + sag or y > bot + sag:
                continue
            u = math.asin(dx)
            tx = int((u / math.pi + 0.5) * (tw - 1))
            ty = int(y - top - sag)
            ty = max(0, min(th - 1, ty))
            col = tex.a[ty, max(0, min(tw - 1, tx))].astype(np.float32)
            # lambert: light from the left and a little toward the viewer
            nx, nz = dx, math.sqrt(1 - dx * dx)
            k = 0.62 + 0.5 * max(0.0, -0.72 * nx + 0.7 * nz) * light
            if dx > 0.82:
                k *= 0.8                                     # the turned-away rim
            if dx < -0.9:
                k *= 1.06
            c = np.clip(col[:3] * k, 0, 255)
            img.a[y, x, :3] = c.astype(np.uint8)
            img.a[y, x, 3] = 255
    for y in range(top, bot + 1):                            # contour down both sides
        t = (y - top) / max(1, bot - top)
        r = r_top + (r_bot - r_top) * t
        img.px_(int(cx - r), y, INK); img.px_(int(math.ceil(cx + r)) - 1, y, INK)


def _tank_tex(w: int, h: int, seed: int) -> Img:
    """Staves of a wooden water tank, iron hoops across them."""
    r = rng('tank', w, h, seed)
    out = Img.new(w, h)
    c = P['wood']
    for x in range(0, w, 4):
        base = r.choice([2, 2, 3, 1])
        out.rect_(x, 0, 4, h, c[base]); out.rect_(x, 0, 1, h, c[min(4, base + 1)])
        out.rect_(x + 3, 0, 1, h, c[0])
    for y in range(4, h, 11):
        out.rect_(0, y, w, 2, R['steel'][1]); out.rect_(0, y, w, 1, R['steel'][3])
    return out


def ellipse_top(img: Img, cx: float, cy: float, rx: float, ry: float, fill: str, rim: str | None = None) -> None:
    img.ellipse_(cx, cy, rx + 0.6, ry + 0.6, INK)
    if rim:
        img.ellipse_(cx, cy, rx, ry, rim)
        img.ellipse_(cx + 0.5, cy + 0.4, rx - 1.6, ry - 1.2, fill)
    else:
        img.ellipse_(cx, cy, rx, ry, fill)


def cone(img: Img, cx: float, base_y: float, rx: float, ry: float, h: int, kind: str = 'shingle', seed: int = 1) -> None:
    """A conical roof: courses in rings, lit left, over an elliptic eave."""
    tex = courses(kind, int(2 * rx) + 4, h + int(ry) + 4, seed)
    for y in range(int(base_y - h), int(base_y + ry) + 1):
        for x in range(int(cx - rx), int(math.ceil(cx + rx))):
            dx = (x + 0.5 - cx) / rx
            if abs(dx) >= 1:
                continue
            eave = base_y + ry * math.sqrt(1 - dx * dx)
            t = (eave - y) / (eave - (base_y - h))
            if t < 0 or t > 1:
                continue
            if abs(dx) > (1 - t) + 0.02:
                continue
            tx = int((dx + 1) / 2 * (tex.w - 1))
            ty = int((1 - t) * (tex.h - 5))
            col = tex.a[ty, tx].astype(np.float32)
            k = 1.12 - 0.42 * (dx + 1) / 2
            img.a[y, x, :3] = np.clip(col[:3] * k, 0, 255).astype(np.uint8)
            img.a[y, x, 3] = 255
    c = ROOF_EDGE[kind]
    for x in range(int(cx - rx), int(math.ceil(cx + rx))):
        dx = (x + 0.5 - cx) / rx
        if abs(dx) < 1:
            e = int(base_y + ry * math.sqrt(1 - dx * dx))
            img.px_(x, e, c[1]); img.px_(x, e + 1, INK)


def scissor_gate(w: int, h: int, open_: float = 0.72) -> Img:
    """A lift's collapsible lattice gate, slid open: the folded bars bunched at the right, the lit
    car open behind the rest — mesh walls, a bulb in a cage, a worn floor with a warning edge."""
    st = R['steel']
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, '#2b2a26')
    out.rect_(2, 2, w - 4, h - 4, '#4a4436')                     # car walls, warm in the bulb's light
    for x in range(3, w - 2, 3):
        out.rect_(x, 3, 1, h - 11, '#5e5644')
    for y in range(5, h - 8, 4):
        out.rect_(2, y, w - 4, 1, '#3c372c')
    out.ellipse_(w / 2, 8, w * 0.42, 7, '#7a6a48', 0.55)
    out.rect_(2, h - 9, w - 4, 7, '#6b5a3c'); out.rect_(2, h - 9, w - 4, 1, '#9a8458')
    out.rect_(2, h - 3, w - 4, 1, '#d8b12e')
    out.rect_(w // 2 - 1, 3, 3, 2, '#fff1c2'); out.rect_(w // 2 - 2, 2, 5, 1, st[1])
    out.rect_(2, 2, 2, h - 4, '#1a1916')                         # the reveal in shade
    fw = int(w * (1 - open_))
    for i, x in enumerate(range(w - fw, w)):                     # the folded gate
        out.rect_(x, 1, 1, h - 2, [st[3], st[1], st[2]][i % 3])
    for y in (4, h // 2, h - 6):
        out.rect_(w - fw, y, fw, 1, st[4])
    out.rect_(0, 0, w, 2, st[3]); out.rect_(0, h - 2, w, 2, st[1])
    return ink(out)


def rollup(w: int, h: int, raised: int, seed: int = 1, inside: str = 'shelves', tone: str | None = None,
           stencil: str | None = None) -> Img:
    """A roll-up steel shutter in a steel frame, `raised` px up from the ground: the drum box on top,
    ribbed slats, the storeroom showing beneath."""
    st = R['galv']
    out = Img.new(w, h)
    box = 6
    out.rect_(0, 0, w, box, st[2]); out.rect_(0, 0, w, 1, st[4]); out.rect_(0, box - 1, w, 1, st[0])
    for x in range(3, w - 2, 6):
        out.px_(x, 2, st[4])
    oy = box
    out.rect_(0, oy, w, h - oy, R['steel'][2])
    ix0, ix1 = 2, w - 2
    if raised:
        op = doorway(ix1 - ix0, raised + 6, glow=WARM, inside=inside, frame='iron', step=False, seed=seed)
        out.paste_(op.crop(2, 0, op.w - 4, op.h), ix0, h - raised - 6)
    sl_bot = h - raised
    sc = rp(tone) if tone else st
    for y in range(oy, sl_bot):
        k = (y - oy) % 3
        out.rect_(ix0, y, ix1 - ix0, 1, [sc[3], sc[2], sc[1]][k])
    r = rng('rollup', w, h, seed)
    for _ in range(w // 10):                                   # dents and rust runs
        x = r.randrange(ix0 + 2, ix1 - 2)
        out.rect_(x, r.randrange(oy + 2, max(oy + 3, sl_bot - 6)), 1, r.randrange(2, 6), P['rust'][2], 0.6)
    if stencil:
        t = sign_text(stencil, '#e8e2cf', None)
        out.paste_(t, (w - t.w) // 2, oy + 5)
    if not raised:
        out.paste_(hazard(ix1 - ix0, 3), ix0, h - 3)
    out.rect_(ix0, sl_bot - 2, ix1 - ix0, 2, R['steel'][1]); out.rect_(ix0, sl_bot - 2, ix1 - ix0, 1, R['steel'][3])
    out.rect_(w // 2 - 3, sl_bot - 3, 6, 1, R['steel'][4])                 # the handle
    out.rect_(0, oy, 2, h - oy, R['steel'][3]); out.rect_(w - 2, oy, 2, h - oy, R['steel'][1])
    return ink(out)


def gates(w: int, h: int, color: str = 'sidegreen', text_: str | None = None) -> Img:
    """Double swing gates of a garage: steel frames, sheet infill with ribs, diagonal braces, a
    wicket door in the left leaf, handles, a painted name."""
    c = rp(color)
    st = R['steel']
    out = Img.new(w, h)
    half = w // 2
    for lx in (0, half):
        out.rect_(lx, 0, half, h, c[2])
        for x in range(lx + 3, lx + half - 2, 5):
            out.rect_(x, 2, 1, h - 4, c[3]); out.rect_(x + 1, 2, 1, h - 4, c[1])
        out.rect_(lx, 0, half, 2, c[3]); out.rect_(lx, h - 2, half, 2, c[1])
        out.rect_(lx, 0, 2, h, c[3]); out.rect_(lx + half - 2, 0, 2, h, c[1])
        out.line_(lx + 2, h - 3, lx + half - 3, 2, c[1]); out.line_(lx + 3, h - 3, lx + half - 2, 2, c[3])
    out.rect_(half - 1, 0, 2, h, INK)
    wx, ww, wh = 6, 12, h - 6
    out.rect_(wx, h - wh - 1, ww, wh, c[1]); out.rect_(wx, h - wh - 1, ww, 1, c[3])
    out.rect_(wx, h - wh - 1, 1, wh, INK); out.rect_(wx + ww - 1, h - wh - 1, 1, wh, INK)
    out.rect_(wx, h - wh - 2, ww, 1, INK)
    out.px_(wx + ww - 3, h - wh // 2, st[4])
    for x in (half - 4, half + 2):
        out.rect_(x, h // 2 - 2, 2, 5, st[3])
    for y in (4, h - 6):                                        # hinges
        out.rect_(0, y, 3, 2, st[1]); out.rect_(w - 3, y, 3, 2, st[1])
    for _ in range(max(1, w // 12)):
        r = rng('gate', w, h, _)
        x, y = r.randrange(2, w - 4), r.randrange(4, h - 4)
        out.rect_(x, y, 1, r.randrange(3, 8), P['rust'][2], 0.7)
    if text_:
        t = sign_text(text_, '#e8e2cf', None)
        out.paste_(t, half + (half - t.w) // 2 + 1, 6)
    return ink(out)


def barrier_arm(length: int) -> Img:
    """A checkpoint boom (шлагбаум) down across the way: red and white stripes, a counterweight
    post at its root. Its root is at the left; 10 px tall."""
    out = Img.new(length + 6, 16)
    st = R['steel']
    out.rect_(0, 2, 6, 14, st[2]); out.rect_(0, 2, 2, 14, st[3]); out.rect_(0, 2, 6, 2, st[4])  # post
    out.rect_(1, 0, 4, 3, '#b3402f')
    for x in range(6, length + 6):
        red = ((x - 6) // 5) % 2 == 0
        out.rect_(x, 5, 1, 3, '#c8433a' if red else '#e9e2d0')
        out.px_(x, 5, '#e87a66' if red else '#ffffff')
        out.px_(x, 7, '#8a2a24' if red else '#b8b0a0')
    out.rect_(length + 3, 4, 3, 5, '#c8433a')
    out.rect_(length + 2, 8, 2, 8, st[1])                       # the fork it rests on
    return outline(out, INK).crop(1, 1, length + 6, 16)


def searchlight() -> Img:
    """A camp searchlight on its yoke: a drum with a bright lens, facing down-right. 14 × 12."""
    st = R['steel']
    out = Img.new(14, 12)
    out.rect_(5, 8, 4, 4, st[1]); out.rect_(3, 10, 8, 2, st[2])
    out.poly_([(1, 5), (4, 0), (11, 3), (8, 9)], st[2])
    out.poly_([(1, 5), (4, 0), (5, 1), (2, 6)], st[3])
    out.ellipse_(9.5, 6, 3, 3.4, st[0])
    out.ellipse_(9.8, 6.2, 2.2, 2.6, '#fff3c0')
    out.px_(9, 5, '#ffffff')
    return outline(out, INK).crop(1, 1, 14, 12)


def flag(frame: int, color: str = '#9e2626', pole: int = 30, n: int = 4) -> Img:
    """A flag on a pole waving in the wind, frame of n. 22 × pole px; the pole's foot is at the
    bottom-left."""
    fr = ramp(color, 4, 0.3)
    out = Img.new(22, pole)
    st = R['steel']
    out.rect_(1, 1, 2, pole - 1, st[3]); out.px_(1, 0, '#e8c14e'); out.px_(2, 0, '#e8c14e')
    fw, fh = 17, 10
    for x in range(fw):
        ph = frame / n * 2 * math.pi
        off = math.sin(x / fw * 2.4 * math.pi - ph) * (x / fw) * 2.2
        tone = math.cos(x / fw * 2.4 * math.pi - ph)
        idx = 3 if tone > 0.4 else (2 if tone > -0.4 else 1)
        y0 = int(round(2 + off))
        out.rect_(3 + x, y0, 1, fh, fr[idx])
        out.px_(3 + x, y0 + fh - 1, fr[max(0, idx - 1)])
    return outline(out, INK).crop(1, 1, 22, pole)


def neon(s: str, color: str, on: bool = True, k: int = 1) -> Img:
    """Neon tube letters: a hot white-ish core in the colour, a halo around; off = a dead grey tube."""
    rr = R[color] if color in R else ramp(color, 5, 0.6)
    core = sign_text(s, rr[3] if on else '#5a5057', None)
    if k > 1:
        core = core.scale(k)
    m = core.a[:, :, 3] > 0
    out = Img.new(core.w + 4, core.h + 4)
    if on:
        halo = np.zeros((out.h, out.w), bool)
        mm = np.zeros((out.h, out.w), bool)
        mm[2:2 + core.h, 2:2 + core.w] = m
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                halo |= np.roll(np.roll(mm, dy, 0), dx, 1)
        c = hexrgb(rr[1])
        out.a[halo] = (c[0], c[1], c[2], 255)
    out.paste_(core, 2, 2)
    if on:
        for y, x in zip(*np.nonzero(m)):
            if (x + y) % 3 == 0:
                out.px_(x + 2, y + 2, rr[4])
    return out


def suit(kind: str, color: str) -> Img:
    """Card suit glyphs, 7 × 7."""
    g = {
        'spade': '...#...|..###..|.#####.|#######|#######|.#.#.#.|...#...',
        'heart': '.##.##.|#######|#######|.#####.|..###..|...#...|.......',
        'diamond': '...#...|..###..|.#####.|#######|.#####.|..###..|...#...',
        'club': '..###..|..###..|##.#.##|#######|##.#.##|...#...|..###..',
    }[kind].split('|')
    out = Img.new(7, 7)
    for y, row in enumerate(g):
        for x, v in enumerate(row):
            if v == '#':
                out.px_(x, y, color)
    return out


def barbed_wire(w: int) -> Img:
    """A coil of barbed wire (спираль) along a parapet: loops with barbs, 7 px tall."""
    st = R['steel']
    out = Img.new(w, 8)
    for x in range(w):
        a = x / 6 * 2 * math.pi
        y = 3.5 + math.sin(a) * 3
        out.px_(x, int(round(y)), st[3] if math.cos(a) > 0 else st[1])
        y2 = 3.5 - math.sin(a + 0.8) * 2.4
        out.px_(x, int(round(y2)), st[2])
        if x % 5 == 0:
            out.px_(x, int(round(y)) - 1, st[4])
    return out


def chains_x(w: int, h: int) -> Img:
    """Two heavy chains crossed over a door, a padlock where they meet."""
    st = R['steel']
    out = Img.new(w, h)
    for (x0, y0, x1, y1) in ((0, 1, w - 1, h - 2), (w - 1, 1, 0, h - 2)):
        n = int(math.hypot(x1 - x0, y1 - y0) / 3)
        for i in range(n + 1):
            t = i / max(1, n)
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            if i % 2:
                out.ellipse_(x, y, 1.6, 1.6, st[3]); out.px_(int(x), int(y), st[0])
            else:
                out.rect_(int(x) - 1, int(y), 3, 1, st[2])
    cx, cy = w // 2, h // 2
    out.rect_(cx - 3, cy - 1, 7, 6, '#9a7a2a'); out.rect_(cx - 3, cy - 1, 7, 1, '#e8c14e')
    out.ellipse_(cx + 0.5, cy - 2, 2.2, 2.4, st[3]); out.ellipse_(cx + 0.5, cy - 2, 1, 1.2, '#00000000')
    out.a[cy - 2:cy, cx:cx + 1] = 0
    out.px_(cx, cy + 2, INK)
    return outline(out, INK).crop(1, 1, w, h)


def glow_crack(img: Img, x: int, y: int, n: int, seed: int, color: str = 'violet', down: bool = True) -> None:
    """A crack in a wall with light leaking out of it: a jagged bright core, a soft glow around."""
    rr = rp(color)
    r = rng('crack', x, y, n, seed)
    pts = []
    cx, cy = x, y
    for i in range(n):
        pts.append((cx, cy))
        cx += r.choice([-1, 0, 1, 1]) if not down else r.choice([-1, 0, 1])
        cy += 1 if down else r.choice([-1, 0, 1])
        if not down:
            cx += 1
    for px, py in pts:
        img.rect_(px - 1, py - 1, 3, 3, rr[2], 0.35)
    for px, py in pts:
        img.px_(px, py, rr[4])
    for px, py in pts[::3]:
        img.px_(px + 1, py, rr[3])


def crystal(h: int = 12, color: str = 'violet', seed: int = 1) -> Img:
    """A cluster of glowing crystals growing out of a crack."""
    rr = rp(color)
    r = rng('crys', h, seed)
    w = h + 2
    out = Img.new(w, h)
    for i, (dx, hh, lean) in enumerate(((w // 2, h, 0), (w // 2 - 4, int(h * 0.65), -2), (w // 2 + 4, int(h * 0.55), 2))):
        top = h - hh
        pts = [(dx - 2, h), (dx - 2 + lean, top + 3), (dx + lean, top), (dx + 2 + lean, top + 3), (dx + 2, h)]
        out.poly_(pts, rr[2])
        out.poly_([(dx - 2, h), (dx - 2 + lean, top + 3), (dx + lean, top), (dx + lean, h)], rr[3])
        out.px_(dx + lean, top + 1, rr[4])
    return outline(out, INK).crop(1, 1, w, h)


def hazard(w: int, h: int) -> Img:
    """Black-and-yellow diagonal hazard stripes."""
    out = Img.new(w, h)
    for y in range(h):
        for x in range(w):
            out.px_(x, y, '#d8b12e' if ((x + y) // 3) % 2 == 0 else '#1e1d1a')
    return out


def loudspeaker() -> Img:
    """A horn loudspeaker (колокол) on a bracket, the camp's voice. 12 × 10."""
    st = R['galv']
    out = Img.new(12, 10)
    out.rect_(0, 1, 2, 6, R['steel'][1])
    out.rect_(1, 3, 3, 1, R['steel'][2])
    out.poly_([(4, 2), (6, 2), (11, 0), (11, 8), (6, 5), (4, 5)], st[2])
    out.poly_([(4, 2), (6, 2), (11, 0), (11, 2)], st[4])
    out.rect_(10, 1, 1, 7, st[0])
    return outline(out, INK).crop(1, 1, 12, 10)


def honour_board(w: int = 30, h: int = 26) -> Img:
    """ДОСКА ПОЧЁТА: a red-framed board with a header and two rows of small portraits."""
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, '#7a2226'); out.rect_(0, 0, w, 1, '#a8323b')
    out.rect_(2, 2, w - 4, h - 4, '#d9cfb6')
    out.rect_(2, 2, w - 4, 5, '#a8323b')
    t = text('ПОЧЁТ', '#f2c46a', None)
    out.paste_(t, (w - t.w) // 2, 2)
    faces = ['#c9a27e', '#b98e6b', '#d6b08a']
    for row in range(2):
        for col in range(3):
            px, py = 4 + col * ((w - 8) // 3), 9 + row * 8
            out.rect_(px, py, 6, 7, '#5a5a5e')
            out.rect_(px + 1, py + 1, 4, 5, '#8a8a90')
            out.rect_(px + 2, py + 1, 2, 2, faces[(row + col) % 3])
            out.rect_(px + 1, py + 4, 4, 2, '#3a3a40')
    out.rect_(w // 2 - 1, h - 2, 3, 2, '#e8c14e')
    return ink(out)


def awning(w: int, depth: int, a: str = '#b8322e', b: str = '#e9e2d0', scallop: bool = True) -> Img:
    """A striped canvas awning seen from above and in front: stripes run down from the wall, the
    front edge hangs in scallops."""
    out = Img.new(w, depth + 4)
    ra, rb = ramp(a, 4, 0.35), ramp(b, 4, 0.3)
    sw = 6
    for x in range(w):
        stripe = (x // sw) % 2 == 0
        r_ = ra if stripe else rb
        for y in range(depth):
            k = y / max(1, depth - 1)
            out.px_(x, y, r_[3] if k < 0.25 else (r_[2] if k < 0.8 else r_[1]))
        if scallop:
            hang = 2 + int(2 * math.sin(((x % sw) + 0.5) / sw * math.pi))
            out.rect_(x, depth, 1, hang, r_[1])
    out.rect_(0, 0, w, 1, '#2a2426')
    return outline(out, INK).crop(1, 0, w, depth + 5)


def laundry_line(w: int, seed: int = 1) -> Img:
    """A washing line with shirts, a sheet and socks hung out — pinned along a wall."""
    r = rng('laundry', w, seed)
    out = Img.new(w, 16)
    out.line_(0, 1, w - 1, 1, '#d8d0c0')
    x = 3
    cols = ['#d9d4c8', '#7c94ad', '#c9b9a0', '#9aa38a', '#e2ddd2', '#a86a5a']
    while x < w - 6:
        kind = r.choice(['shirt', 'sheet', 'sock', 'shirt'])
        c = ramp(r.choice(cols), 4, 0.35)
        if kind == 'shirt':
            out.rect_(x, 2, 9, 3, c[2]); out.rect_(x + 2, 5, 5, 8, c[2])
            out.rect_(x + 2, 5, 1, 8, c[3]); out.rect_(x + 6, 5, 1, 8, c[1])
            out.rect_(x + 3, 2, 3, 1, c[1])
            x += 11
        elif kind == 'sheet':
            ww = r.randrange(12, 18)
            out.rect_(x, 2, ww, 12, c[3])
            for xx in range(x + 2, x + ww, 4):
                out.rect_(xx, 2, 1, 12, c[2])
            out.rect_(x, 13, ww, 1, c[1])
            x += ww + 2
        else:
            out.rect_(x, 2, 2, 6, c[2]); out.rect_(x, 7, 3, 2, c[2])
            x += 5
        out.px_(x - 2, 1, '#8a6446')
    return outline(out, INK).crop(1, 0, w, 16)


def milk_can() -> Img:
    st = R['galv']
    out = Img.new(9, 13)
    out.rect_(1, 5, 7, 8, st[2]); out.rect_(1, 5, 2, 8, st[4]); out.rect_(6, 5, 2, 8, st[1])
    out.poly_([(1, 5), (3, 2), (6, 2), (8, 5)], st[3])
    out.rect_(2, 0, 5, 2, st[3]); out.rect_(3, 0, 3, 1, st[4])
    out.rect_(1, 8, 7, 1, st[1])
    return outline(out, INK).crop(1, 1, 9, 13)


def dog_house(w: int = 20, h: int = 17) -> Img:
    """A kennel (будка): plank walls, a pitched roof, a round hole, a bowl beside."""
    wd = P['wood']
    out = Img.new(w, h)
    out.rect_(1, 7, w - 2, h - 7, wd[2])
    for x in range(1, w - 1, 3):
        out.rect_(x, 7, 1, h - 7, wd[1])
    out.poly_([(0, 8), (w // 2, 1), (w, 8)], R['tinred'][2])
    out.poly_([(0, 8), (w // 2, 1), (w // 2, 8)], R['tinred'][3])
    out.ellipse_(w / 2, h - 3, 4, 5, '#1a1210')
    out.rect_(w // 2 - 4, h - 3, 8, 3, '#1a1210')
    return outline(out, INK).crop(1, 1, w, h)


def straw_bale(w: int = 18, h: int = 11) -> Img:
    st = P['straw']
    out = Img.new(w, h)
    out.rect_(0, 0, w, 4, st[3]); out.rect_(0, 4, w, h - 4, st[2])
    for x in range(1, w, 3):
        out.rect_(x, 5, 1, h - 6, st[1])
    for x in (4, w - 5):
        out.rect_(x, 0, 1, h, '#6b4f2a')
    return ink(out)


def steel_door(w: int, h: int, tone: str = 'bunker', glow: str | None = None, step: bool = True) -> Img:
    """A riveted steel double door in a heavy frame; light leaks through the seam and under it
    when `glow` is given (the sealed shaft)."""
    c = ['#1f2622', '#2e3833', '#43504a', '#5c6b63', '#7c8b82'] if tone == 'bunker' else rp(tone)
    st = R['steel']
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, st[2]); out.rect_(0, 0, w, 1, st[4]); out.rect_(0, 0, 1, h, st[4])
    ix0, iy0, ix1, iy1 = 2, 2, w - 2, h - (3 if step else 0)
    half = (ix1 - ix0) // 2
    for lx in (ix0, ix0 + half):
        out.rect_(lx, iy0, half, iy1 - iy0, c[2])
        out.rect_(lx, iy0, half, 1, c[3]); out.rect_(lx, iy0, 1, iy1 - iy0, c[3])
        out.rect_(lx + half - 1, iy0, 1, iy1 - iy0, c[1])
        out.rect_(lx + 2, iy0 + (iy1 - iy0) // 2, half - 4, 1, c[1])       # the stiffener
        out.rect_(lx + 2, iy0 + (iy1 - iy0) // 2 + 1, half - 4, 1, c[3])
        for y in (iy0 + 2, iy1 - 3):
            for x in range(lx + 2, lx + half - 1, 3):
                out.px_(x, y, c[4])                                        # rivets
    out.rect_(ix0 + half - 3, iy0 + 5, 2, 4, st[3])                         # handles
    out.rect_(ix0 + half + 1, iy0 + 5, 2, 4, st[3])
    if glow:
        g = rp(glow)
        out.rect_(ix0 + half - 1, iy0, 2, iy1 - iy0, g[3])
        out.rect_(ix0 + half, iy0 + 1, 1, iy1 - iy0 - 2, g[4])
        out.rect_(ix0, iy1 - 1, ix1 - ix0, 1, g[3])
    out = ink(out)
    if glow:
        g = rp(glow)
        out.rect_(ix0 + half - 1, iy0 + 2, 2, iy1 - iy0 - 4, g[3])
        out.px_(ix0 + half, iy0 + 4, g[4])
    if step:
        stn = P['concrete']
        out.rect_(0, h - 3, w, 3, stn[2]); out.rect_(0, h - 3, w, 1, stn[4]); out.rect_(0, h - 1, w, 1, INK)
        out.rect_(0, h - 3, 1, 3, INK); out.rect_(w - 1, h - 3, 1, 3, INK)
        if glow:
            out.rect_(2, h - 3, w - 4, 1, rp(glow)[3])
    return out


def rat_sign() -> Img:
    """A yellow warning triangle with a rat on it (for the lift down to the rats). 15 × 13."""
    from lib import grid
    out = Img.new(15, 13)
    out.poly_([(7.5, 0), (15, 13), (0, 13)], INK)
    out.poly_([(7.5, 2.2), (13.2, 12), (1.8, 12)], '#e0b32e')
    rat = grid(['..##....', '.####.#.', '######.#', '.#..#...'], {'#': INK})
    out.paste_(rat, 3, 6)
    return out


def lantern(lit: bool = True) -> Img:
    """A hanging storm lantern: wire bail, tin cap, a glass globe with the flame."""
    out = Img.new(7, 11)
    st = R['steel']
    out.rect_(3, 0, 1, 2, st[2])
    out.rect_(1, 2, 5, 2, st[2]); out.rect_(1, 2, 5, 1, st[3])
    out.rect_(1, 4, 5, 5, '#f4c86a' if lit else '#6b6a60')
    out.rect_(3, 5, 1, 3, '#fff6d0' if lit else '#4a4a44')
    out.rect_(1, 4, 1, 5, st[1]); out.rect_(5, 4, 1, 5, st[1])
    out.rect_(0, 9, 7, 2, st[2])
    return outline(out, INK).crop(1, 0, 7, 11)
