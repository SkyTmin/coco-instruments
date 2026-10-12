---
paths:
  - "src/lib/props-pixel/chests.ts"
  - "src/lib/props-pixel/sprites-chests.ts"
  - "src/lib/props-pixel-chests.test.ts"
  - "src/components/ChestTab.tsx"
  - "public/ui/px/chests/**"
---

## Pixel chests — `lib/props-pixel/chests.ts`, `components/ChestTab.tsx`

Infra (bake, `PxStrip`, `propFit`, manifest, testkit) — `.claude/rules/props-pixel.md`. Game rules
of chests (bundle, odds, scene story) — `books-chests.md` «Сундуки v2.71».

- **Drawn in code, not rendered.** One shared model (body box with walls+floor, barrel lid on the
  BACK hinge, hasp, lock plate, loot heap) ray-cast from convex primitives (slab, elliptic
  cylinder, ellipsoid, half-space) in affine frames; shaded with the pets rig
  (`newFrame/seams/rimLight/toPx/selOutline`, imported, never edited). Own camera: elevation 0.42
  (above pets' 0.27 so the lid top and the inside read), chest yaw −0.42, light fixed in the world
  (`LIGHTC`). Five looks (`LOOK`) differ only in palettes/trims — pose, size and frame are SHARED,
  the scene swaps tiers under a flash.
- **Strips** (`STRIPS`): `idle-<tier|mystery>` 24 f @12 (sheen; epic/rare twinkle; legend floats
  + warm seam glow 0.32), `mystery-spin` 22 f @24 large only (two real 3D turns), `open-<tier>`
  26/30/40/54 f @24 with marks `turn, latch, lidOpen, peak` and the `lock` anchor (box %).
  Frame 0 of idle = closed icon; last frame of open = open icon; open frame 0 = idle frame 0 + key.
- **Overlays are depth-tested** against the frame's z-buffer (outline pixels take the neighbour's
  depth): runes/coins behind the chest vanish behind it. Beam depth = opening centre.
- **Light from inside**: shaders flag emissive pixels (keyhole, lid crack, plank gaps) → `leakFx`
  before opening; after it `inner` lifts lining/loot tones and the beam rises from the opening.
- **Rarity ladder**: common — creak, dust puffs at the lip and hinges, two coin glints; rare — lid
  pops, blue sparks, light ring; epic — shake, hop, lid bursts, purple beam, 6 runes orbit with
  depth, landing dust + ring; legend — spark swirl, long shake, hop, lid flings, golden beam,
  burst + full flash, coin fountain (ballistic, one bounce, rest on their own depth), shockwave.
- **Scene** (`ChestScene`): fly = `mystery-spin` loop; land/reveal = `idle-mystery` + CSS glow at
  `--lx/--ly`; reveal/key = tier idle loop phase-locked to reach frame 0 when the key lands; key =
  CSS drop flying to the anchor (`lockAt(240)` via `pxFitOf`); then `open-<tier>` `once` drives
  everything by marks (sounds, phase «open», cards at `peak` + `CARDS_AFTER`). Skip tap unmounts
  the strip and shows the open still. Strips preload on tab mount (spin, dark) and scene mount
  (tier idle/open, 240 px).
- **Sizes chosen for exact fits**: scene 240 (large ×2 css → ×6 on DPR 3, ×4 on DPR 2), batch and
  odds 48 (small ×1 css), hero 180 (→ 200/180), dock icon 30 (crisp on DPR 3, smoothed on DPR 2).
- **CSS moves pixel art only by translate** (tremble, breathe, press); no rotate (it smears
  pixels). The land squash and the fly scale stay — short and moving.
- **Lessons**: a heap ellipsoid poked under the floor — cut it with a half-space z ≥ floor;
  plane shapes need E2×E1 for a front-facing normal; quantize the LOCAL normal before transforming
  (facets swim otherwise); effects must end ≥ 2 frames before the last open frame (test checks
  the last two are byte-identical); legend's seam glow must start at its idle level or the swap
  pops; puffs dither only in their last 40% (dithered from the start they read as checkerboards).
- **Checks**: `npx vitest run src/lib/props-pixel-chests.test.ts`; previews without baking —
  render frames with `frame(name, i, res)` from a vite-node script. Rebake:
  `npx vite-node scripts/props-pixel/bake.ts -- --set chests` (~20 s, 491 KB: small 115, large
  377; open-legend large 173 KB). Stand: `page.clock` (Playwright) freezes timers + rAF so slow
  DPR 3 screenshots don't drift; seed keys via `import('/src/store.ts')` in the page.
- Old 3D renders `public/ui/chests/*` removed. `scripts/pets-ink/src/pets/90-props.js` and
  `tools/props-post.py` still draw the ink chests/eggs — unused by the app for chests now.
