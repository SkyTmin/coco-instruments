"""Каптёрка (v2.80) — the storeroom: chests, keys, camp kit.

11 × 13 tiles. Red brick walls, a concrete floor. The clerk stands behind a counter with the
ledger, the abacus and the rubber stamp; behind him on the wall, the key board — hooks with
«слёзы гаста», the green-yellow tear drops that open the chests (mark `keys` is the board, for
the game to print how many the player has). Shelving on both sides of him: boxes, bundles tied
with string, folded quilted jackets, boots, ushankas. On the visitors' side: the pyramid of
chests in four tiers — common oak, rare iron-bound blue, epic violet, the legendary gold one on
top catching the light — and in the east a padlocked wire cage over the valuables. A ladder,
a coil of rope, a bench of uniforms with boots under it, crates by the door.

Lessons from the review rounds:
  1. A green drop hung by a ring on its tip reads as a PEAR. The tear hangs straight from the
     hook by a needle tip, lit from inside (pale core, lime body, green rim) with a big glint.
  2. The kit's 3 × 5 Д is the same shape as А: «ВЫДАЧА» came out «ВЫААЧА». Signs use words
     without Д (ПРАВИЛА) until the font is fixed.
  3. A coat on a peg drawn as a trapezoid reads as a cupboard door: square shoulders, sleeves
     hanging apart, a collar and buttons.
  4. A rope coil of filled ellipses is a pie; separate turns with dark gaps and a twist read
     as rope.
  5. The rope, the pyramid's corner and the cage pinched the lane to half a tile; objects near
     the lane are checked on the half-tile collision grid, not by eye.
  6. The tall wire cage's top rail climbs a tile and a half above its feet: anything in the
     rows in front of it gets its lower part covered. The trolley and the box pile stand by
     the counter instead.
  7. The concrete floor's big blotches read as camouflage under this many objects; the tan
     cobble (na-sand, the kit's floor for stores) is calmer and the chests still stand off it.
"""
from __future__ import annotations

from art_shops import dust_decal, ladder, poster, rope_coil, shelf_unit
from kit import INK, P, barrel, crate, ink, lamp_hanging, paper, sack, shell, window
from lib import T, Img, Map, grid, outline, ramp, rng

W, H = 11, 13

# chest tiers: body ramp, band ramp, lock colour
TIERS = {
    'common': (P['wood'], P['iron'], P['iron'][3]),
    'rare': (['#1d2c44', '#2c4468', '#3d5f8c', '#5a82b0', '#86a8d0'], P['iron'], '#c8d4de'),
    'epic': (['#2a1a3e', '#452a66', '#6b3fa0', '#8f63c8', '#b494e6'], ['#5a4a28', '#8f7a3a', '#c2a24a', '#e0c870', '#f4e4a0'], P['gold'][3]),
    'legend': (['#6e4a10', '#a8781c', '#d8a82a', '#f0cc4a', '#fff0a0'], ['#5a2a10', '#8a4418', '#b06a28', '#d89a48', '#f0c880'], '#ffffff'),
}


# ------------------------------------------------------------------------------------ art
def chest(tier: str, frame: int = 0) -> Img:
    """A chest, 16 × 13: a curved lid seen from above (4 px of top), a front with two bands and a
    lock plate. Common: oak with iron bands. Rare: blue with iron bands and rivets. Epic: violet
    with gilt bands and a gem. Legendary: gold with red-brown leather bands and gems; `frame`
    walks a glint across its lid."""
    body, band, lock = TIERS[tier]
    w, h = 16, 13
    out = Img.new(w, h)
    # lid: top face and its front lip
    out.rect_(0, 0, w, 5, body[3]); out.rect_(0, 0, w, 1, body[4]); out.rect_(0, 4, w, 1, body[1])
    out.rect_(1, 1, w - 2, 1, body[4] if tier != 'common' else body[3])
    # body front
    out.rect_(0, 5, w, 8, body[2]); out.rect_(0, 5, 2, 8, body[3]); out.rect_(w - 2, 5, 2, 8, body[1])
    out.rect_(0, 12, w, 1, body[1])
    if tier == 'common':
        for y in (7, 10):
            out.rect_(2, y, w - 4, 1, body[1])                                   # planks
    # bands over lid and front
    for x in (3, w - 5):
        out.rect_(x, 0, 2, h, band[2]); out.rect_(x, 0, 1, h, band[3])
    if tier == 'rare':
        for x in (3, w - 5):
            for y in (2, 7, 10):
                out.px_(x + 1, y, band[4])
    out = ink(out)
    # lock plate
    out.rect_(6, 4, 4, 5, band[1] if tier != 'legend' else band[2]); out.rect_(6, 4, 4, 1, band[3])
    out.px_(7, 6, lock); out.px_(8, 6, lock); out.px_(7, 7, INK)
    if tier == 'epic':
        out.px_(7, 2, '#6fe0e0'); out.px_(8, 2, '#c8ffff')
    if tier == 'legend':
        out.px_(7, 2, '#e0402a'); out.px_(8, 2, '#ff9a8a')
        out.px_(1, 9, '#40c0d0'); out.px_(14, 9, '#40c0d0')
        gx = [2, 6, 10, 14, -9][frame % 5]
        if gx >= 0:
            out.px_(gx, 1, '#ffffff'); out.px_(gx + 1, 1, '#fff8d0'); out.px_(gx, 0, '#fff8d0')
    return out


def chest_pyramid(frame: int) -> Img:
    """Chests stacked in four tiers — four common oak, three rare blue, two epic violet and the
    legendary gold one on top — each tier half a chest in from the one below, like cans in a shop
    display. 64 × 49."""
    w, h = 64, 49
    out = Img.new(w, h)
    rows = [('common', 4), ('rare', 3), ('epic', 2), ('legend', 1)]
    for i, (tier, n) in enumerate(rows):
        y = h - 13 - i * 12
        x0 = (w - n * 16) // 2
        for k in range(n):
            out.paste_(chest(tier, frame if tier == 'legend' else 0), x0 + k * 16, y)
    return out


def tear(frame: int = 0, lit: bool = False) -> Img:
    """A key as the camp knows it — a ghast's tear: a glassy drop, a long needle tip on top and
    a full belly below, lit from inside (pale yellow core, lime body, green rim), a big white
    glint. Hung straight from the hook by its tip — with a ring on top it read as a pear. 7 × 12."""
    g = ['...k...', '...w...', '..kwk..', '..kyk..', '.kyyyk.', '.kywyk.', 'kyywyyk', 'kyyyygk', 'kgyyygk',
         'kggyggk', '.kgggk.', '..kkk..']
    out = grid(g, {'k': '#24461e', 'w': '#fbffd8', 'y': '#c8ec50', 'g': '#5aa832'})
    out.px_(2, 6, '#ffffff'); out.px_(2, 7, '#ffffff')
    if lit:
        out.px_(1, 5, '#fbffd8'); out.px_(5, 5, '#fbffd8'); out.px_(3, 0, '#ffffff')
    return out


def key_board(frame: int) -> Img:
    """The key board behind the clerk: a varnished plank with a painted number over each of two
    rows of brass hooks, most with a tear hanging, two empty; one tear glints per frame. For the
    wall face (placed as an object so it shimmers). 36 × 32."""
    w, h = 36, 32
    out = Img.new(w, h)
    wd, g = P['wood'], P['gold']
    out.rect_(0, 0, w, h, wd[2]); out.rect_(0, 0, w, 1, wd[4]); out.rect_(0, 1, w, 1, wd[3])
    out.rect_(0, h - 2, w, 2, wd[1])
    for x in range(0, w, 9):
        out.rect_(x, 2, 1, h - 4, wd[1])                                          # the planks
    out = ink(out)
    slots = []
    for row in range(2):
        for i in range(4):
            x, y = 1 + i * 9, 2 + row * 15
            out.rect_(x + 2, y, 3, 1, g[3]); out.px_(x + 3, y + 1, g[1])        # the hook
            slots.append((x, y + 1))
    hang = [0, 1, 3, 4, 5, 7]
    for n, i in enumerate(hang):
        x, y = slots[i]
        out.paste_(tear(frame, lit=(n == frame % len(hang))), x, y)
    for i in (2, 6):                                                             # empty hooks, a number tag
        x, y = slots[i]
        out.rect_(x + 1, y + 3, 5, 4, P['paper'][3]); out.rect_(x + 2, y + 4, 3, 1, P['paper'][0])
        out.rect_(x + 2, y + 6, 2, 1, P['paper'][0])
    return out


def shelf_box(w: int, h: int, color: str = '#b08a5a', seed: int = 1) -> Img:
    """A cardboard box, seen from the front: tape across the top, a stencilled number, a light
    left edge."""
    c = ramp(color, 4, 0.4)
    out = Img.new(w, h)
    out.rect_(0, 0, w, h, c[2]); out.rect_(0, 0, 1, h, c[3]); out.rect_(0, 0, w, 1, c[3])
    out.rect_(w // 2, 0, 1, max(2, h // 3), '#d8c8a0')
    r = rng('box', seed)
    if w > 6 and h > 5:
        out.rect_(2, h - 3, r.randrange(2, w - 3), 1, c[0])
    return ink(out)


def bundle(color: str = '#7a6a58') -> Img:
    """A bundle of cloth tied crosswise with string. 10 × 7."""
    c = ramp(color, 4, 0.4)
    out = Img.new(10, 7)
    out.ellipse_(5, 4, 5, 3, c[2]); out.ellipse_(4, 3, 3.5, 2, c[3])
    out.rect_(5, 0, 1, 7, '#d8c8a0'); out.rect_(0, 4, 10, 1, '#d8c8a0')
    return outline(out, INK).crop(1, 1, 10, 8)


def jacket_stack(n: int = 3, color: str = '#3a4356') -> Img:
    """Folded quilted jackets (ватники) stacked: each a slab with stitch lines across. 14 × 3n+2."""
    c = ramp(color, 4, 0.35)
    out = Img.new(14, n * 3 + 2)
    for i in range(n):
        y = out.h - 4 - i * 3
        out.rect_(0 + (i % 2), y, 13, 3, c[2]); out.rect_(0 + (i % 2), y, 13, 1, c[3])
        for x in range(2 + (i % 2), 13, 3):
            out.px_(x, y + 1, c[1])
    return ink(out)


def boots() -> Img:
    """A pair of black kirza boots standing, tall shafts, toes to the left. 11 × 10."""
    g = ['.kkk.kkk..', '.k1kk1k...', '.k1kk1k...', '.k1kk1k...', '.k1kk1k...', '.k11kk1k..', 'k111k11kk.',
         'k1111k111k', 'kkkkkkkkkk']
    out = grid(g, {'k': INK, '1': '#34383e'})
    out.px_(2, 2, '#6c727a'); out.px_(5, 2, '#6c727a'); out.px_(1, 7, '#4d5259')
    return out


def ushanka() -> Img:
    """A fur hat with its ear flaps tied up. 10 × 7."""
    f = ['#3a3028', '#5c4a3a', '#7a6450', '#9a8068']
    out = Img.new(10, 7)
    out.ellipse_(5, 4, 5, 3, f[1]); out.ellipse_(4.5, 3.2, 3.5, 2, f[2]); out.rect_(0, 4, 10, 2, f[2])
    out.rect_(3, 1, 4, 1, f[3]); out.px_(5, 3, P['red'][2])
    return outline(out, INK).crop(1, 1, 10, 8)


def kit_shelves(seed: int) -> Img:
    """A tall shelving unit of camp kit: boxes of two sizes, bundles tied crosswise, stacks of
    folded jackets, boots, ushankas; more boxes piled on top. 40 × 50."""
    rows = []
    rows.append([shelf_box(10, 8, '#b08a5a', seed), shelf_box(8, 8, '#9a7a50', seed + 1), bundle('#6b5a48'),
                 shelf_box(6, 6, '#b89a6a', seed + 2)])
    rows.append([jacket_stack(3), jacket_stack(2, '#4a4a3a'), ushanka()])
    rows.append([boots(), boots(), bundle('#556070'), bundle('#7a6a58')])
    rows.append([shelf_box(12, 9, '#a07e50', seed + 3), shelf_box(9, 9, '#b08a5a', seed + 4), shelf_box(9, 7, '#8a6e48', seed + 5)])
    if seed % 2:
        rows[0], rows[2] = rows[2], rows[0]
    return shelf_unit(40, 50, rows, mat='woodgrey', back='#221a18',
                      top_row=[shelf_box(12, 7, '#a88a5a', seed + 9), shelf_box(9, 5, '#9a7a50', seed + 8)], legs=2)


def ledger_counter() -> Img:
    """The counter: a heavy plank top with the ledger open (ruled columns, a tally), an abacus
    with red and white beads, an inkwell with a quill, a rubber stamp and a bell; the front in
    vertical boards with a lifting flap. 54 × 26."""
    w, h = 54, 26
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(0, 0, w, 9, wd[3]); out.rect_(0, 0, w, 1, wd[4]); out.rect_(0, 8, w, 2, wd[1])
    for x in range(3, w, 11):
        out.rect_(x, 1, 1, 7, wd[2])
    out.rect_(0, 10, w, h - 10, wd[2])
    for x in range(0, w, 5):
        out.rect_(x, 10, 1, h - 10, wd[1])
    out.rect_(0, 10, w, 1, wd[0]); out.rect_(0, h - 2, w, 2, wd[1])
    out.rect_(38, 10, 14, h - 12, wd[3]); out.rect_(38, 10, 1, h - 12, wd[4])   # the flap
    out.px_(50, 16, P['iron'][3]); out.px_(50, 18, P['iron'][3])
    out = ink(out)
    # the ledger
    pg = P['paper']
    out.rect_(12, 0, 20, 8, '#3a2a22')
    out.rect_(13, 0, 9, 7, pg[3]); out.rect_(22, 0, 9, 7, pg[2])
    for y in (2, 4, 6):
        out.rect_(14, y, 7, 1, pg[0]); out.rect_(23, y, 7, 1, pg[0])
    out.rect_(17, 1, 1, 6, P['red'][2]); out.rect_(26, 1, 1, 6, P['red'][2])
    for x in (24, 25, 27, 28):
        out.px_(x, 3, '#1a1a1a')                                                 # tally marks
    # the abacus (счёты): a frame with rows of beads
    ab = Img.new(10, 7)
    ab.rect_(0, 0, 10, 7, '#5c3d2e'); ab.rect_(1, 1, 8, 5, '#2a1d19')
    for y in (1, 3, 5):
        ab.rect_(1, y, 8, 1, '#8a8a80')
        for x in ([1, 2, 6] if y == 1 else [1, 5, 6, 7] if y == 3 else [2, 3, 4]):
            ab.px_(x, y, '#e8e0cc' if x < 5 else P['red'][3])
    out.paste_(ink(ab), 1, -1)
    # inkwell and quill
    out.rect_(33, 2, 3, 3, '#1a1a2a'); out.px_(34, 2, '#3d6fb0')
    out.line_(35, 1, 38, -2, '#e8e8e8')
    # rubber stamp and a stamp pad
    out.rect_(40, 3, 5, 3, P['red'][1]); out.rect_(41, 0, 3, 3, P['wood'][3]); out.rect_(41, 0, 3, 1, P['wood'][4])
    # the bell
    out.ellipse_(49.5, 4, 2.5, 2, P['gold'][3]); out.rect_(47, 5, 6, 1, P['gold'][1]); out.px_(49, 1, P['gold'][2])
    out.px_(48, 3, '#fff8d0')
    return out


def wire_cage(frame: int) -> Img:
    """The locked cage for valuables in the corner: angle-iron posts, a mesh front and a mesh side,
    a door with a hasp and a big padlock; behind the mesh, a safe, crates and an epic chest whose
    gem winks. The mesh is drawn over the contents, one diagonal lattice at half strength, so
    what is inside stays readable. 50 × 44."""
    w, h = 50, 44
    out = Img.new(w, h)
    ir = P['iron']
    # floor inside and the back
    out.rect_(0, 8, w, h - 8, '#1c1a1c'); out.rect_(0, h - 12, w, 12, '#2a2828')
    # contents
    sf = Img.new(16, 18)
    sf.rect_(0, 0, 16, 18, '#4a5058'); sf.rect_(0, 0, 16, 3, '#6c727a'); sf.rect_(1, 4, 14, 12, '#3a3f46')
    sf.ellipse_(8, 10, 3, 3, '#8a9098'); sf.px_(8, 10, INK); sf.rect_(12, 9, 2, 3, P['gold'][2])
    out.paste_(ink(sf), 4, h - 22)
    out.paste_(crate(14, 14), 22, h - 18)
    out.paste_(crate(12, 12, dark=True), 24, h - 29)
    out.paste_(chest('epic'), 34, h - 16)
    if frame % 3 == 0:
        out.px_(41, h - 14, '#ffffff')
    # mesh
    mesh = Img.new(w, h)
    for k in range(-h, w, 4):
        mesh.line_(k, 8, k + h, 8 + h, ir[4])
        mesh.line_(k + h, 8, k, 8 + h, ir[4])
    mesh.a[:8, :, 3] = 0
    out.paste_(mesh, 0, 0, 0.55)
    # frame: posts, top rail, the door frame, the padlock
    for x in (0, 16, w - 3):
        out.rect_(x, 4, 3, h - 4, ir[2]); out.rect_(x, 4, 1, h - 4, ir[3])
    out.rect_(0, 4, w, 3, ir[2]); out.rect_(0, 4, w, 1, ir[3])
    out.rect_(0, h - 3, w, 3, ir[1])
    out.rect_(3, 20, 13, 2, ir[2])
    out = ink(out)
    out.rect_(14, 22, 5, 2, ir[3])                                               # hasp
    lk = grid(['.kkk.', 'k...k', 'k...k', 'kgggk', 'kgKgk', 'kgggk', '.kkk.'],
              {'k': INK, 'g': P['gold'][3], 'K': INK})
    out.paste_(lk, 14, 22)
    out.rect_(18, 10, 12, 6, P['red'][2]); out.rect_(19, 12, 10, 1, '#f2e6c8'); out.rect_(19, 14, 7, 1, '#f2e6c8')
    out.rect_(18, 10, 12, 1, P['red'][3])
    return out


def uniform_bench() -> Img:
    """A bench piled with folded uniforms and a shirt laid out, three pairs of boots lined up
    under it. 42 × 24."""
    w, h = 42, 24
    out = Img.new(w, h)
    wd = P['wood']
    out.rect_(0, 8, w, 4, wd[3]); out.rect_(0, 8, w, 1, wd[4]); out.rect_(0, 11, w, 1, wd[1])
    out.rect_(2, 12, 3, 10, wd[2]); out.rect_(w - 5, 12, 3, 10, wd[1])
    out = ink(out)
    out.paste_(jacket_stack(3), 2, 9 - jacket_stack(3).h)
    out.paste_(jacket_stack(2, '#4a4a3a'), 16, 9 - jacket_stack(2).h)
    out.paste_(ushanka(), 31, 9 - 6)
    for i in range(3):
        out.paste_(boots(), 6 + i * 11, h - 10)
    return out


def coat_hook() -> Img:
    """A quilted jacket and an ushanka hanging from a peg: square shoulders, the sleeves hanging
    apart from the body, a collar, buttons down the front, quilting lines. A plain trapezoid read
    as a cupboard door. 16 × 28."""
    c = ramp('#3a4356', 4, 0.35)
    out = Img.new(16, 28)
    out.rect_(7, 5, 2, 2, P['wood'][2])                                              # the peg
    out.rect_(1, 8, 14, 4, c[2]); out.rect_(1, 8, 14, 1, c[3])                        # shoulders
    out.rect_(1, 11, 3, 14, c[2]); out.rect_(1, 11, 1, 14, c[3])                      # sleeves
    out.rect_(12, 11, 3, 14, c[1])
    out.rect_(4, 11, 8, 16, c[2]); out.rect_(4, 11, 3, 16, c[3])                      # body
    for y in range(14, 27, 3):
        out.rect_(4, y, 8, 1, c[1])
    out.rect_(7, 11, 1, 16, c[0])
    out.rect_(5, 7, 6, 2, '#6b5a48')                                                 # collar
    out = ink(out)
    for y in (13, 17, 21):
        out.px_(8, y, '#c8b890')
    out.paste_(ushanka(), 3, 0)
    return out


def clock() -> Img:
    """A round wall clock: white face, black hands at ten to two. 11 × 11."""
    out = Img.new(11, 11)
    out.ellipse_(5.5, 5.5, 5.5, 5.5, P['wood'][2]); out.ellipse_(5.5, 5.5, 4.2, 4.2, '#eee8d8')
    out = outline(out, INK).crop(1, 1, 11, 11)
    out.line_(5, 5, 3, 3, INK); out.line_(5, 5, 8, 4, INK); out.px_(5, 5, P['red'][2])
    for x, y in ((5, 1), (9, 5), (5, 9), (1, 5)):
        out.px_(x, y, '#4a4a4a')
    return out


def rules_sheet() -> Img:
    """The issue rules pinned up: ПРАВИЛА in red, ruled lines, a violet stamp. 30 × 20. (The kit
    font's Д reads as А, so ВЫДАЧА came out ВЫААЧА — words without Д until the font is fixed.)"""
    p = poster(30, 20, '#d6ccb3', None, 'ПРАВИЛА', '#a8323b', seed=7)
    for y in (10, 13, 16):
        p.rect_(3, y, 24 - (y % 3) * 4, 1, P['paper'][0])
    p.rect_(22, 14, 5, 4, '#6b3a7a')                                                  # a stamp
    return p


def clothes_rack() -> Img:
    """A standing rail of issue clothing: an iron frame on two feet, five quilted jackets on
    hangers in three shades, a greatcoat longer than the rest. 34 × 34."""
    w, h = 34, 34
    out = Img.new(w, h)
    ir = P['iron']
    out.rect_(1, 2, 2, 30, ir[2]); out.rect_(w - 3, 2, 2, 30, ir[1])
    out.rect_(0, 31, 6, 3, ir[2]); out.rect_(w - 6, 31, 6, 3, ir[1])
    out.rect_(1, 2, w - 2, 2, ir[3])
    out = ink(out)
    tones = ['#3a4356', '#4a4a3a', '#3a4356', '#5a4a3a', '#34383e']
    for i, t in enumerate(tones):
        c = ramp(t, 4, 0.35)
        x = 3 + i * 6
        L = 22 if i == 3 else 16
        out.line_(x + 3, 4, x + 1, 6, ir[3]); out.line_(x + 3, 4, x + 5, 6, ir[3])   # hanger
        jk = Img.new(8, L)
        jk.poly_([(1, 0), (7, 0), (8, L), (0, L)], c[2])
        jk.poly_([(1, 0), (4, 0), (3, L), (0, L)], c[3])
        for y in range(3, L, 3):
            jk.rect_(0, y, 8, 1, c[1])
        jk.rect_(3, 0, 2, 2, c[0])
        out.paste_(ink(jk), x, 6)
    return out


def box_pile() -> Img:
    """Cardboard boxes piled three high, one open with a jacket sleeve hanging out. 28 × 30."""
    out = Img.new(28, 30)
    out.paste_(shelf_box(14, 11, '#b08a5a', 21), 0, 19)
    out.paste_(shelf_box(13, 10, '#9a7a50', 22), 14, 20)
    out.paste_(shelf_box(15, 11, '#a88a5a', 23), 5, 9)
    op = shelf_box(12, 9, '#b89a6a', 24)
    op.rect_(1, 0, 10, 2, '#3a2a20')                                                 # opened flaps
    out.paste_(op, 8, 0)
    out.rect_(10, 7, 3, 5, '#3a4356'); out.rect_(10, 7, 1, 5, '#556178')              # a sleeve
    return out


def trolley() -> Img:
    """A two-wheeled hand trolley with a box and a bundle strapped on, tipped back. 20 × 30."""
    out = Img.new(20, 30)
    ir = P['iron']
    out.line_(4, 0, 6, 26, ir[3]); out.line_(5, 0, 7, 26, ir[2])
    out.line_(15, 0, 17, 26, ir[1]); out.line_(16, 0, 18, 26, ir[1])
    out.rect_(3, 0, 13, 2, ir[3])
    out.rect_(5, 26, 15, 2, ir[2])
    out = ink(out)
    out.paste_(shelf_box(11, 10, '#b08a5a', 31), 6, 15)
    out.paste_(bundle('#556070'), 6, 8)
    out.rect_(5, 19, 13, 1, '#8a3a2a')                                               # the strap
    for x in (3, 14):
        out.ellipse_(x + 2, 27, 3, 3, INK); out.ellipse_(x + 2, 27, 1.4, 1.4, ir[3])
    return out


def extinguisher() -> Img:
    """A red fire extinguisher standing on the floor: body, black hose, a steel valve. 8 × 16."""
    out = Img.new(8, 16)
    r = P['red']
    out.rect_(1, 4, 6, 12, r[2]); out.rect_(1, 4, 2, 12, r[3]); out.rect_(6, 4, 1, 12, r[1])
    out.ellipse_(4, 4, 3, 2, r[2])
    out.rect_(3, 1, 2, 3, P['iron'][3]); out.rect_(2, 0, 4, 1, P['iron'][2])
    out.rect_(1, 8, 6, 3, '#e8e0cc')
    out = ink(out)
    out.line_(5, 2, 7, 6, INK)
    return out


# ------------------------------------------------------------------------------------ map
def build() -> Map:
    m = Map('store', W, H, 'indoor', name='Каптёрка', ambient=0.58, music='yard')
    shell(m, 'brick', 'na-sand', face=2, door=(4, 2), out_to='square', out_at='store', floor_seed=4)
    g = m.ground
    r = rng('store-floor')

    # --- ground: worn path from the door to the counter, dust in the corners, string and paper
    m.stamp(dust_decal(2 * T, 6 * T, 11, '#2a2018', 0.12, 40), 4 * T, 6 * T)
    m.stamp(dust_decal(3 * T, 2 * T, 12, '#2a2018', 0.18, 30), 1 * T, 10 * T)
    m.stamp(dust_decal(3 * T, 2 * T, 13, '#2a2018', 0.18, 30), 7 * T, 3 * T)
    for i, (x, y) in enumerate(((3 * T + 6, 7 * T + 12), (6 * T + 2, 8 * T + 6))):
        m.stamp(paper(6, 7, 30 + i), x, y)
    for _ in range(4):
        x, y = r.randrange(2 * T, 9 * T), r.randrange(6 * T, 11 * T)
        g.line_(x, y, x + r.randrange(3, 7), y + r.randrange(-2, 3), '#e8d8b0', 0.9)   # bits of string

    # --- north wall face: window, clock, the key board behind the clerk, rules, a coat on a peg
    m.stamp(window(16, 12, bars=3), 1 * T + 12, T + 2)
    m.light(2 * T + 4, 2 * T + 4, 30, '#9fc4d0', 'window')
    m.stamp(clock(), 3 * T + 3, T + 3)
    kb = [key_board(i) for i in range(6)]
    m.put('store.keyboard', kb, 5 * T - 18, T, base=3 * T - 1, fps=3)
    m.marks['keys'] = (5.0, 2.0)
    m.stamp(rules_sheet(), 6 * T + 3, T + 2)
    m.stamp(coat_hook(), 9 * T, T + 3)

    # --- shelving on both sides of the clerk, the ladder against the east one
    s1 = kit_shelves(1)
    m.put('store.shelves1', s1, 1 * T, 5 * T - 2 - s1.h, solid=(1, 3, 3.5, 4.8))
    s2 = kit_shelves(2)
    m.put('store.shelves2', s2, 7 * T - 8, 5 * T - 2 - s2.h, solid=(6.5, 3, 9, 4.8))
    ld = ladder(48, 12)
    m.put('store.ladder', ld, 8 * T + 2, 5 * T + 2 - ld.h, solid=(8.1, 4.5, 8.9, 5.1))
    ex = extinguisher()
    m.put('store.extinguisher', ex, 4 * T - 6, 12 * T + 1 - ex.h, solid=(3.6, 11.5, 4.1, 12))

    # --- the clerk behind the counter
    ct = ledger_counter()
    m.put('store.counter', ct, 5 * T - 27, 5 * T + 3, solid=(3.3, 5.3, 6.7, 6.6))
    m.npc('clerk', 'clerk', 5.0, 4.95, face=0, anim='idle', name='Каптёрщик')
    m.marks['clerk'] = (5.0, 4.95)
    m.block(3.3, 4.8, 3.5, 5.3); m.block(6.5, 4.8, 6.7, 5.3)                      # close the gaps behind
    m.put('store.lamp', lamp_hanging(24), 5 * T + 12, 3 * T - 4, layer='top')
    m.light(5 * T + 17, 5 * T + 4, 56, '#ffd98a', 'lamp')
    m.emit('dust', 5 * T + 17, 4 * T + 8, 0.4)                     # dust hanging in the lamp light

    # --- the visitors' side, west: the clothes rail and the chest pyramid, legend glinting on top
    cr = clothes_rack()
    m.put('store.rack', cr, 1 * T - 1, 7 * T + 8 - cr.h, solid=(1, 6.9, 3, 7.5))
    cp = [chest_pyramid(i) for i in range(5)]
    m.put('store.chests', cp, 1 * T - 1, 10 * T - cp[0].h, fps=4, solid=(1, 9.2, 4.9, 10))
    m.light(3 * T - 2, 7 * T + 8, 28, '#ffd76a', 'glow')
    m.emit('motes', 3 * T - 2, 7 * T + 6, 0.35)                    # the legendary chest sparkles

    # --- east: a trolley of boxes, the locked cage, the rope coil and a barrel in the corner
    tl = trolley()
    m.put('store.trolley', tl, 7 * T - 2, 6 * T + 8 - tl.h, solid=(6.9, 5.7, 8, 6.5))
    bp = box_pile()
    m.put('store.boxes', bp, 8 * T + 4, 6 * T + 6 - bp.h, solid=(8.3, 5.5, 10, 6.4))
    wc = [wire_cage(i) for i in range(3)]
    m.put('store.cage', wc, 7 * T - 4, 10 * T + 4 - wc[0].h, fps=2, solid=(6.8, 8.6, 10, 10.2))
    m.put('store.rope', rope_coil(), 8 * T + 12, 11 * T - 6, solid=(8.8, 10.5, 9.9, 11.1))

    # --- by the door: the uniform bench (west), crates and a sack (east)
    ub = uniform_bench()
    m.put('store.bench', ub, 1 * T + 2, 12 * T + 1 - ub.h, solid=(1.1, 11.2, 3.7, 12))
    m.put('kit.crate', crate(), 7 * T + 2, 11 * T + 1, solid=(7.1, 11.2, 8.1, 12))
    m.put('kit.crate.dark', crate(dark=True), 7 * T + 4, 10 * T + 6, solid=(7.2, 10.6, 8.2, 11.2))
    m.put('kit.sack', sack('#6f6352'), 8 * T + 4, 11 * T + 4, solid=(8.2, 11.4, 9, 12))
    m.put('kit.barrel', barrel(), 9 * T + 2, 12 * T - 17, solid=(9.1, 11.2, 10, 12))
    return m
