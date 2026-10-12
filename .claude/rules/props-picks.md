---
paths:
  - "src/lib/props-pixel/picks.ts"
  - "src/lib/props-pixel/sprites-picks.ts"
  - "src/lib/props-pixel-picks.test.ts"
  - "src/components/{PickArt,ForgeScreen,PrisonCamp}.tsx"
  - "public/ui/px/picks/**"
---

# Pixel pickaxes (set `picks`)

17 picks (`PICKS` in `lib/economy.ts`), code-drawn on the pets rig (`lib/pets-pixel/rig.ts`,
import only). Shared infra (PxStrip, bake, manifest, testkit) belongs to the props-pixel set —
don't edit it from here.

## Strips
- `icon-<i>` — 1 frame, the clean icon (no particles). `spin-<i>` — 48-frame 2 s loop, a real
  3D turn about the handle; frame 0 = the icon (test). Effects by rarity in the spin: glints
  r≥1, aura motes r≥2, rim glow r≥3, depth-tested orbit motes r≥4, halo r6.
- `forge-r<r>` — one 'once' strip per rarity, LARGE only (`res: ['l']`), 1.8 s (r0) … 3.2 s (r6);
  marks `strike1..3`, `quench`, `reveal`; ends on an empty frame (test). Timeline:
  `forgeTimes(r)`. Hot blank on the anvil → 3 hammer strikes (sparks; rarity seams from strike
  2 at r≥2, rarity sparks on strike 3) → quench steam → glowing silhouette (r≥3 rises with a
  pillar, r≥4 runes + shockwave + shake, r≥5 dark crust with widening cracks and a 3D turn) →
  flash star at `reveal` (ring r≥2, sunburst + shards r≥5) → anvil dithers out.
- Boxes: small 48 (canvas 72), large 112 (canvas 168). Shared pose: head up-left, handle down-
  right (`pickPose(THETA0)`); the forge's final pick uses the same pose, so the real pick can
  replace it without a shift.
- Bake: `npx vite-node scripts/props-pixel/bake.ts -- --set picks [--only a,b] [--sheet DIR]`
  (~25 s). Weights: icons 0.5/1.3 KB, spins 6–13 KB small / 19–38 KB large, forge 29–67 KB;
  set ≈ 1.04 MB on disk, out of the SW precache, loaded on demand.

## Drawing (picks.ts)
- `SPECS[i]` = material of head/eye/fit/grip + `rar`; form grows with rarity in `buildPick`:
  rings r≥2, poll gem r≥3, pommel gem r≥4, langets r≥5; handle wood darkens pine → ebony.
- Textures live in pick-local coords (u, n, b) — they turn with the pick, never crawl.
- Facets: 'bar' prisms / 'cab' cuts write a facet-edge buffer (FB/FE) for bright edges.
- Forge-only effects are 2D on the finished frame (`sparkle`, `ring`, `flashStar`, `sunburst`,
  `pillar`, steam). After `reveal` they skip `iconMask` (the real pick is under them) and radii
  are clamped to the canvas; `forgeFrame` clears the 1-px canvas border (post.py fails on any
  pixel touching it).

## Integration
- `PickArt` (pedestal, ApplyScene, reveal): CSS keeps only the soft backdrop (glow, rays r≥4,
  pillar r6); the pick is `PxStrip` at `size·PICK_ART` (0.8) — `spin-<i>` when live and ≥ 96 px,
  else `icon-<i>` still. `dim` = CSS silhouette filter on `.pxs`.
- `PickPx` (icon still): forge ladder (34 px) and `PickIcon` in the camp/mine/books (13–46 px).
- `ForgeReveal`: `FORGE_PX = 150` — at DPR 2 and 3 both the forge strip (large-only) and the
  spin (`PickArt` 188) get the same integer-scale large box (test), so the swap at `reveal` is
  pixel-exact. Marks → `forgeStrike(i)` + `tapMedium` + stage shake; `quench` → `lavaHiss()`
  (lazy sample, may be silent the very first time); `reveal` → real pick under the strip,
  `forgeReveal`, `notifySuccess`, `flashFrame`, confetti r≥3. Tap before the reveal skips. The
  caption is mounted hidden from the start (`.fgr__text.is-wait`) so the stage doesn't jump.
  The CSS backdrop stays forge-orange until the reveal (no early rarity leak).
- Preload: `ForgeScreen` preloads `forge-r<next rarity>` and `spin-<next>` once forging is
  possible; PxStrip starts the 'once' strip only after decode.
- Reduced motion: no strip, the reveal fires on mount.

## Pitfalls
- `Px.set` with alpha 0 is a no-op (it blends) — clear pixels via `p.data.fill(0, …)`.
- A large-only strip falls back to irregular scale when `propFit` can't reach an integer one;
  pick the scene size so both strips share the large fit (see the propFit test).
- Steam/flash/rings must die before the last frame; the test checks the last frame is empty.
