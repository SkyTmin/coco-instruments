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
  drop vanishes. Nothing may touch the canvas edge (post.py fails) — the pillar top
  dithers out below y=0.
- **Scenes**: reveal glyph sits on a dark radial disc (`.pbks__sigil::before`) — a light glyph
  vanished in the white pages and pillar. The result text is rendered from the first frame,
  hidden (`.pbks:not(.is-show) .pbks__text`), so the stage doesn't jump up at the strip→`BookArt`
  swap; `.pbka__text` min-height 124 for the same reason at `hit`. Preload: tier card
  `pointerdown`, buy/anvil/apply handlers, scene mount.
- **Weights** (s / l KB): reveal 11/32, 18/45, 26/73, 39/108 (simple→legend); apply-ok ≤10/26;
  burn ≤11/35; idle ≤5/18; still ≤1. Set total ≈ 680 KB.
- **Stand shots**: scenes are fast and a DPR 3 screenshot takes ~0.8 s on the shared box, so
  shots were taken with a slowed clock (init script scales `Performance.prototype.now`, rAF
  timestamps = that `now`, `setTimeout`; CDP `Animation.setPlaybackRate`). Patching only
  `performance.now` on the instance silently failed and the strip started seconds late.
- Preview without baking: scratch `preview.ts`/`sheet.py` pattern — `frame(name,i,res)` →
  RGBA → PIL sheet. Bake: `npx vite-node scripts/props-pixel/bake.ts -- --set books`.
