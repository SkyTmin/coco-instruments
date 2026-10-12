---
paths:
  - 'src/lib/props-pixel/**'
  - 'scripts/props-pixel/**'
  - 'src/components/PxStrip.tsx'
  - 'src/lib/props-pixel-*.test.ts'
---

## Pixel props — shared pipeline (eggs, chests, books, picks)

Owner sees the ink props as «наклейка»; props go to pixels by the pets/boss reference. One
pipeline for every prop set; a set = a painter module + generated manifest + strips.

- **Painter** `src/lib/props-pixel/<set>.ts` (type `PropSetModule` in `types.ts`): `RES`
  (`s` small box 36 / `l` large box 112; canvas `cw×ch`, box top-left `bx,by` — leave room for
  particles), `STRIPS` (`frames, fps, loop, marks?, anchors?, res?` — `res: ['l']` bakes only
  that size), `frame(name, i, res) → Px`. Pure TS, deterministic (no `Math.random`), draws with
  `../pets-pixel/rig` (import only). The game never imports painters — only manifests + strips.
- **Bake**: `npx vite-node scripts/props-pixel/bake.ts -- --set <set> [--only a,b|prefix*]
[--res s] [--sheet DIR] [--keys N] [--no-game]` → `.tmp/<set>/<res>/<name>.rgba` →
  `post.py` (pillow): crop to the union of frames +1 px (FAILS if the drawing touches the canvas
  edge), grid layout (WebP ≤ 16000 px wide), lossless WebP `public/ui/px/<set>/<name>[-l].webp`,
  manifest `src/lib/props-pixel/sprites-<set>.ts` (prettier-clean) + `scripts/props-pixel/<set>.json`
  (with bytes). `rev` = sha1 of the strip's files (`?v=`). Full run deletes stale strips.
  `--sheet`: key-frame sheets ≤ 800 px (frame 0, last, every mark, evenly spaced).
- **Fit** (`fit.ts`, `propFit`): integer device px per art px; large if ≥ 2 px and within 15 %,
  else small; < 1.5 px → smoothed. 220 → large 224 (DPR 2 and 3), 72@3 → large 74.7, 72@2 →
  small 72, 26@3 → small 24.
- **Player** `PxStrip` (`set, name, size, mode loop|once|still, frame, phase, align, poster,
onMark, onEnd, label`): one shared rAF clock, only `transform` per frame; 'once' starts after
  decode (shows `poster` frame 0 until then), fires marks when their frame is SHOWN, `onEnd`
  after the last frame (+ guard timer). Reduced motion: loop → frame 0; once → last frame, all
  marks + onEnd at once (callers that play sounds on marks should skip the strip instead).
  `preloadPx(set, name, size)` — call on the tap that will show a 'once' strip.
- **SW**: `**/ui/px/**` out of the precache, runtime CacheFirst `coco-px`. After `npm run
build`, `grep -c "ui/px/" dist/sw.js` → 1.
- **Tests** use `testkit.ts`: `manifestProblems(mod, PX, ROOT)` (names, n/fps/loop, marks,
  sizes, files), `seamRatio` (loop seam ≤ largest step), `sameBytes`, `pxDiff`.

## Eggs (`eggs.ts`, `sprites-eggs.ts`, `EggArt` in `PetArt.tsx`, `HatchScene`/`HatchBatch`)

- **Model**: surface of revolution `r(s) = R·√(1−s²)·(1−a·s)` (wider below), ray-marched per
  pixel with the rig camera (EL 0.27) and a depth buffer; stone chips by CSG. Patterns live in
  LOCAL (φ, s) — they turn with the egg (r5 spins, scales come round). Moss: brown speckled
  shell + moss clumps thicker toward the bottom + sprout (rig parts). Stone: grey granite,
  carved teal runes (emissive grooves), chips. Crystal: rhombus facets from two skew lattices
  over (φ, s) (`CUT_N` 7 × `CUT_M` 4.6), facet normal per cell, inner core seen through the
  wall, glints. Dragon: overlapping scale discs, thin ember veins with a pulse (lub-dub), smoke
  wisp (7 overlapping puffs; 4 read as separate dots).
- **Strips** (24 fps): `idle-<egg>` 48 frames (2 s, both sizes; loop seam test), `hatch-<egg>-r<r>`
  (large only) for every rarity the egg can drop (`EGG_RARITIES` = `EGGS[].odds` > 0, test),
  `pop-<egg>` 15 frames (small only, burst on frame 6) for «Вылупить все».
- **Hatch timeline** (`hatchPlan`): wobble `HATCH_WOB` 1.1…2.9 s by rarity, cracks at 0.34 /
  0.62 / 0.86 of it, burst at its end, `clear` 5 frames later, then `HATCH_POST` 0.8…1.15 s of
  falling pieces. Marks `w1 (0), crack1, w2, crack2, w3, crack3, burst, clear`. Each crack is
  a knock: squash frame, then a bigger wobble (0.18 / 0.28 / 0.38 rad × (1 + 0.06 r)); rocking
  is a rotation about the bottom pole + lift so the lowest point stays on the floor (test
  `lowestZ` ≤ 0.35 px for r < 3; r ≥ 3 hovers). Frame 0 = idle frame 0, last frame empty (tests).
- **Rarity ladder**: r0/r1 dark cracks with a pale broken edge; r2+ cracks glow in the rarity
  colour (light leaks before the open), rays from behind, floor ring; r3 hovers + precesses,
  light pillar (depth-tested slab); r4 + orbiting runes, shake, shockwave ring (flattened, in
  the floor plane); r5 rises (10 units) and spins faster and faster, cracks spread over the
  whole egg, a second band of cuts (`net.band`) doubles the shards (20), they orbit then fly,
  sunburst. A hovering egg bursts in the air — no floor dust under it.
- **Pieces come from the crack net** (`crackNet` → `pieceOf`: ring + vertical splits; cap
  above, petals below), drawn as point splats (outer = material, inner = membrane lit by the
  rarity glow, broken edge = pale rim). Cap: ballistic with one bounce (`fly`), snapped to the
  floor once landed (`ground`). Petals: `petal()` — hop + tip OUTWARD ~80° with a small bounce
  (rotation about `z × out` by a POSITIVE angle tips the top outward; the old negative angle
  folded them inward into a pile). The floor holds the lowest point of every piece (`lift`);
  moss tufts riding on pieces must add the same lift (they sank 60 px below the floor).
- **Canvas** l 360×384 (box 112 at 124,206): petals tipping toward the viewer and the r5
  orbit reach ~45 px below the floor line; material bits fly ≈ 1.5 egg widths (faster ones hit
  the canvas edge).
- **Integration**: `EggArt` = `PxStrip idle-<egg>` — `still` below 60 px, loop from 60 (nest 72,
  sheet 88), class `pegg-img` kept for old selectors; inventory egg = `size × 1.15` (the old
  `.inv-slot > .pegg-img { width: 76% }` override broke the integer fit). `HatchScene`: one
  `PxStrip once` 220 with `poster idle-<egg>`; sounds/flash/confetti/phase by marks, `onEnd` →
  buttons; tap skips; reduced motion → no strip, `eggHatch` + done. `doHatch` preloads the strip
  right after the roll. CSS pillar, SVG cracks, leak, halves and wobble keyframes removed (the
  strip draws them); CSS rays/burst glow stay behind the pet. `HatchBatch`: `BatchEgg` breathes
  the idle frame with the CSS wobble, at `i × step` plays `pop-<egg>` once (burst at +250 ms,
  the pet tile appears at `--i × --step + 250ms`), pop strips preloaded on mount.
- **Weight** (lossless WebP): idle s 3–7 KB, l 17–50 KB; hatch 64 (moss r0) … 247 KB (dragon
  r5, the brief's cap is 250 — r5 was 306 KB at 3.2 + 1.35 s; trimmed to 2.9 + 1.05 s, smoke
  fades after crack1, pillar and sunburst fade earlier); pop 4–5 KB; set total ≈ 1.6 MB, a
  player loads idle + one hatch strip per hatch. Post-burst frames cost ~2× pre-burst ones
  (pieces, dither, pillar stripes) — trim the post first.
- **Stand** (not committed): `px-stand.html?scene=pets&nest=dragon,crystal&eggs=moss:3&rnd=0.999`
  renders the real `PetsTab` with a patched store and a fixed `Math.random` (rarity), so the
  hatch scene and «Вылупить все» run for real. Screenshots at DPR 3 are slow (~0.5 s each) —
  timings of later shots drift, read `pxLog` for exact mark times. **Not checked on a phone.**
