---
paths:
  - "src/lib/props-pixel/books.ts"
  - "src/lib/props-pixel/books-idle.ts"
  - "src/lib/props-pixel/sprites-books.ts"
  - "src/lib/props-pixel-books.test.ts"
  - "src/components/BooksTab.tsx"
  - "public/ui/px/books/**"
---

## Pixel enchantment books (props round, 2026-10) — `lib/props-pixel/books.ts`

Replaced the 3D cover renders (`public/ui/books/{tier}.webp`, `scripts/books-render` —
deleted; `enchanter.webp` stays). Infra (bake, `PxStrip`, manifest) belongs to the eggs
agent — `.claude/rules/props-pixel.md`; don't edit it from here.

- **Model**: own convex-solid raytracer `drawSolids` (box slabs, elliptic cylinder, cut
  half-spaces; per-face painter → tone or `[palette, tone]`) + rig `drawParts`/`seams`/
  `rimLight`/`toPx`/`selOutline`. Book-local: x spine→fore-edge, y thickness (front +T/2),
  z up. Pose → `bookXf` (squash → lean → roll → yaw → move); front cover and sheets hang
  on `hingeZ(open, HINGE)`. Rest pose `REST` (yaw 0.42, fore-edge toward viewer).
- **Tiers**: simple brown leather + cord + frayed corners; rare blue cloth, silver corners,
  strap clasp; epic purple, gold corners, octagon gem; legend black/crimson, gold fillets,
  two chained hasps, glowing sigil ring. Palettes `COVER`…`DUST`, `palsOf(tier)`.
- **Strips** (24 fps, canvas s 120×172 box 48, l 280×400 box 112): `still-<t>`, `idle-<t>`
  (loop; bob from `books-idle.ts`), `reveal-<t>` (marks land/snap/open/peak/close/lock),
  `apply-ok-<t>` (open/hit/gone, anchor `to` = where streaks land), `apply-burn-<t>`
  (ignite/crumble). Last reveal frame = still, first apply frame = still, last apply
  frames empty — tests hold this.
- **Glyph is an overlay, not baked**: 10 enchant icons × 4 tiers would be 40 strips.
  Anchors `glyph`/`glyphX`/`glyphY` (medallion centre, +x edge, +z edge) → `glyphStyle`
  builds a CSS `matrix()` so a 100×100 mask lies in the medallion with the cover's turn.
  The idle bob is shared: `BookArt` runs its own rAF from mount (same t0 as `PxStrip`)
  and moves `.pbook__bob` by `bookIdleBob`. Reveal: glyph lights at `peak` on anchor
  `rise`, sinks into the pages on `close`; `BookArt` takes over on `onEnd`.
- **Sizes**: reveal 170, apply book 112 (92 fell to the small strip), tier cards 56 (58 gave
  a 2.42× non-integer scale at DPR 2). `.pbook__in` keeps the strip centred when CSS
  shrinks `.pbook` (inventory cell).
- **Pitfalls**: `STRIPS = buildStrips()` must stay at the end of the file (TDZ on consts it
  reads). For air tiers the takeoff `kf` must ADD to the drop height (`o.z +=`), or the
  drop vanishes. Nothing may touch the canvas edge (post.py fails) — hi effects draw
  through `hp`/`bg`, which keep a 1-px margin.
- **Scenes**: reveal glyph sits on a dark radial disc (`.pbks__sigil::before`) — a light glyph
  vanished in the white pages and pillar. The result text is rendered from the first frame,
  hidden (`.pbks:not(.is-show) .pbks__text`), so the stage doesn't jump up at the strip→`BookArt`
  swap; `.pbka__text` min-height 124 for the same reason at `hit`. Preload: tier card
  `pointerdown`, buy/anvil/apply handlers, scene mount.
- **Weights** (s / l KB): reveal 11/32, 18/45, 52/143, 71/178 (simple→legend); apply-ok ≤14/35;
  burn ≤12/35; idle ≤5/18; still ≤1. Set total ≈ 906 KB (680 before the epic/legend redo).

### Epic and legend redone (after v2.140) — `revealPoseHi`/`revealFrameHi`, `applyFrameHi`

Owner: «обычная и редкая нравится; эпическая и легендарная — недоработано, эффекты не
проработаны, качественнее, плавнее, чуть медленнее». Simple and rare run the OLD code paths
byte for byte — test «простая и редкая — байт в байт как в v2.140» hashes every frame of all 20
simple/rare strips (sha1 constants; re-baking them only moves nothing). Never touch `revealPose`,
`revealFrame`, `applyFrame`, `star`/`mote`/`dust`/`ring`/`risingMotes`/`streak`; epic/legend go
through `isHi(tier)` in `frame()` and `riseAnchor`; `burnFx(…, hi)` gates its changes.

- **Timing**: epic T 3.55 (land 0.8, snap 1.45, open 1.75, peak 2.45, close 2.85, lock 3.2),
  legend T 4.6 (1.0, 1.85, 2.25, 3.1, 3.6, 4.1). `RevealScene` follows the marks by itself.
- **Story**: portal ring at `PORTAL_Z` (dark disc + banded ring; epic cyan diamonds, legend
  gold halo spikes + falling light streaks) → the book comes out bottom-first (`clipAbove` the
  portal line) as a glow silhouette that `condense`s to its own colours in 6 steps → landing
  squash + thick floor ring WITH a light wall (`hring(…, wall)`) + spark wreath → build-up
  (epic: summoning circle with hexagram + converging cyan spirals; legend: chains strain, sigil
  pulses, rising sparks) → snap (epic clasp star; legend hasps burst, links fly white-hot →
  gold, one bounce, fade by tone) → takeoff, cover twitch (anticipation), open with overshoot,
  staggered riffle → peak: beam + burst rings + spark fountain + star ring (legend: thin rays,
  runes orbit) → close with bounce, beam narrows (core last) → second landing on `lock` with a
  ring → settle into idle0; every effect ends ≥ 0.06 s before the last frame (pop check:
  changed pixels between the last two frames ≤ ~30).
- **Light around, not on, the book**: page glow capped 0.6, no `pose.flash`; `aura` (stepped
  bands from the silhouette, only on empty pixels via `sc.body`), `rimGlow` recolours the ink
  outline; `bg()` draws only where the book isn't. `hp()` = depth-tested `put` with a 1-px
  canvas margin (post.py).
- **Beam** (`beam`): white core + 3 bands + halo, 1-px row wobble, width flicker, wider foot;
  the TOP is ragged per column (`colTop`: core highest, edges lower, a running wave) with −1/−2
  tone at each column's end. Tried and rejected: width steps (read as a pagoda), sqrt taper
  (a bullet), linear taper (a pencil).
- **Particles**: `sparkPx` (head 1–2 px ×2 on large + trail against velocity, tone by age, slow
  sparks get a cross), `ballistic` (drag + gravity), `star4` (white core, rays darken outward),
  `floorBurst`, `fountain`, `spiral`; legend runes = 5×7 bitmaps (`GLYPHS`, ×2 on large) on a
  tilted orbit, far side behind the book by depth. No checkerboard dither anywhere in the hi
  path (shadow `shadowHi` = two alpha steps).
- **Apply/burn hi**: `applyFrameHi` — glow capped, aura + rim while lit, `streakHi` (stepped
  tail, star head, shed sparks), hit = `star4` + small `burstRing`, `dissolveHi` (ragged column
  front + 3-step light band, no dither), legend links snap hot. Burn: epic violet / legend
  gold-crimson flame tongues (`FLAME_*`), flakes vanish whole per flake, `burnSparksHi`.
  Frame 0 still = still and the last frame empty (tests).
- Scratch tools (not committed): `hashes.ts` (sha1 per strip), `pops.ts` (changed pixels per
  frame), `preview.ts` + `sheet.py`.
- **Stand shots**: scenes are fast and a DPR 3 screenshot takes ~0.8 s on the shared box, so
  shots were taken with a slowed clock (init script scales `Performance.prototype.now`, rAF
  timestamps = that `now`, `setTimeout`; CDP `Animation.setPlaybackRate`). Patching only
  `performance.now` on the instance silently failed and the strip started seconds late.
- Preview without baking: scratch `preview.ts`/`sheet.py` pattern — `frame(name,i,res)` →
  RGBA → PIL sheet. Bake: `npx vite-node scripts/props-pixel/bake.ts -- --set books`.
