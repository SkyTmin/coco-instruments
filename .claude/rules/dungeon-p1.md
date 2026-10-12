---
paths:
  - "src/lib/dungeon*.ts"
  - "src/components/Dungeon*.tsx"
  - "src/pages/DungeonPage.tsx"
  - "scripts/dungeon-mapgen.py"
---

<!-- Working summary (v2.103). History of stage П1 and edits v2.59–v2.66 with measurements —
     `.claude/archive/dungeon-p1-history.md` (not auto-loaded; grep by version or name). -->

# Dungeon: foundation (stage П1) — world, combat, frame, sack, tiles, rats

Three-quarter top-down view, **manual combat — NO auto-combat (the owner is against it)**,
entry — «Клеть» in the yard from rank F. Files: rules `lib/dungeon.ts`, world
`dungeon-world.ts` + maps `dungeon-maps.ts`, combat `dungeon-sim.ts`, pixels
`dungeon-art.ts`, frame `dungeon-render.ts`, hero `dungeon-sprites.ts`, tiles
`dungeon-tiles.ts` (atlas frames `dungeon-x72-frames.ts`), props `dungeon-props.ts`, rats
`dungeon-rats.ts`; `components/DungeonRun.tsx` (run), `DungeonMine.tsx`, `DungeonCamp.tsx`,
`DungeonInventory.tsx`, `pages/DungeonPage.tsx`; map generator `scripts/dungeon-mapgen.py`.

## Game rules (owner's decisions)

- **Seamless world, no transitions** (quote: «без геодезии»): the only loading screen is
  the cage. Areas are stacked bottom to top; position is saved in LOCAL area coordinates
  (`area, x, ly`) — a new area added below doesn't shift everyone into a wall.
- **Prices are constant** since v2.66 (`MEAT_BASE`, `AREA_MEAT`, `PLUS_FEE`, `REFORGE_FEE`,
  `KING_COINS`, `SACK_PRICE`, `LIFT_PRICE`; `econOf` removed). **Coins don't unlock
  tiers**: reforging is unlocked by conditions — only kills and ore (helmet — «добыть
  пирита», the `ore` stat is written by the mine straight into the store) — and storage
  materials; otherwise a slot-machine jackpot would skip dozens of hours. «Выйти живым»
  (exit alive) was removed from the conditions; a test holds that.
- **Death takes only the sack.** Kills, XP, metres, grates, lanterns stay: the delta
  (`takeDelta`) goes to the store every 5 s, on area change, death and ascent. Don't make
  death a "progress rollback".
- **Loot leaves only by cage, and only a repaired one** (`lifts`); it's repaired with coins
  and pelts from storage, not from the sack (that isn't carried out yet).
- **The run lives in the store (`run`).** Telegram «Назад» first opens pause
  (`registerEscape`); from pause you can go up without the cage — the run waits below with
  the same sack; on return, 2 s of invulnerability.
- **Controls:** left half — floating joystick (dead zone 14%); «Удар»: tap — a three-hit
  combo, hold — heavy, swipe — directional strike; tap on a rat — target; «Рывок» passes
  through a bite, at the last moment — slow-mo and a guaranteed crit; «Вихрь» charges from
  hits; meat heals, but in the sack it smells and attracts rats. Rig: WASD, J, K, L, Q, E.
- **Dash** — a 0.3 s lunge with deceleration (starts 3× faster than running), 2.5 cells,
  fading silhouettes behind. Invulnerability blinking on dash is off (read as a teleport).
  Invulnerability is 0.27 s of 0.3 — with the full 0.3 the test «король на Лагерном без
  заточки» failed.
- **Sack = Minecraft-style slots** (`sackSlots`, `slotsUsed`, `canTake`, `sackStacks`): a
  row of 9 slots, stacks up to 32 (crown — one), pockets — up to 4 rows. Don't weaken the
  meat smell "every 10 pieces": Откатка without food stops being dangerous. A big sack is
  the risk.
- **Inventory** (`DungeonInventory.tsx`) — the world stands still, the palette is
  deliberately Minecraft-like (owner's request). Reforge progress includes the run's
  not-yet-sent delta. Dropped items land with `age −1,6` so the magnet doesn't pick them up
  at once.
- **Sharpening, reforging, pocket — right inside the run** (`dungeonUpgradeHere`,
  `dungeonSackUpHere`): materials from storage first, the shortfall from the sack
  (`payFromBoth`), coins — the shared wallet. `save()` BEFORE paying (reforge conditions
  read the store), AFTER — recompute the hero and `save()` again, otherwise a restart
  returns materials from the old snapshot. A pocket in the camp without leaving the run: the
  waiting run gets rebuilt.
- **Mines below** — our `MineField` + `useMineDig`, loot goes to the sack. Ore durability
  from the rank's rock (`deepHp`), one field per time window (`deepField`), extraction 85%.
  While you dig the world stands still, but you make noise: every 35 blocks a pack at the
  entrance, at most three (2, 3, 3), you come out to it (`packAtMine`). No green dots on
  pyrite — it's recognisable by its drawing.
- **Explored stays lit forever:** `sim.fog` (radius 5), `cutExplored` cuts the darkness by
  82% (`EXPLORED_LIT`) with a "dot per cell" mask, smoothed. Not 100% — the lantern and
  lamps still have work to do; for dark areas the share should probably be per-area.
- **Lair door** (v2.66): the gate cell isn't part of the arena — the winner is flagged
  `exiting`, the gate closes only once he's farther than `GATE_CLEAR` (2.5 cells); you
  can't get to a resting king from outside. Test — 200 exits (previously 0 of 200: the gate
  closed on the hero).

## Frame and render

- **The frame bypasses React.** The world is measured in game pixels (frame ≈160 wide),
  but drawn STRAIGHT onto the screen canvas with an integer scale and fractional camera;
  positions are snapped to a screen DOT (`q()`), sprite pixels are even squares. **Don't
  bring back a stretched buffer and `Math.round` in game pixels** — the jitter returns
  (offsets 7, 7, 14, 7 dots).
- **The combat step is per frame**, a long frame is cut into pieces ≤ 1/60 s (a fixed 1/60 s
  with an accumulator gave 0 or 2 steps at 90–120 Hz — jerks). Camera lead is smoothed
  separately and ignores dash speed. A smooth camera on the rig is ~8.6 dots per frame.
- Light — a `destination-out` mask in a small buffer, put on screen with smoothing; rat
  eyes — AFTER light. The React HUD updates at most 8 times per second and only on change.
- **Map chunks of 16×16 cells are cached**, redrawn only on a cell change or a hit on a
  crack. A chunk is assembled in ONE pixel buffer (`blit` into `Px`) and output in one
  call; tile cells return `Px`, not a canvas. The cost was in canvases (~250 per chunk —
  18.5 ms, up to 70; now 4.9, p90 9), not in noise. ≤40 chunks (eviction); each frame
  draws one missing chunk from the ring around the screen. Stutter on a phone when a chunk
  scrolls in — look at `prefetch` and chunk size.
- **The cache key must cover the image:** the slab variant comes from the key, not from
  coordinates. Ground and rock face are stitched to neighbours with noise — not cached.
- **Pitfalls:** the first `requestAnimationFrame` frame arrives with a timestamp EARLIER
  than `performance.now()` (dt < 0, pose frame −1 → `paintHero` crashed) — the step is
  clamped at zero, the pose frame uses a positive modulo. StrictMode unmounts the effect
  immediately — a write on unmount made a new run a "continuation": write only if
  `sim.time > 0.3`. A rat queued in a burrow (`t < 0`) slid into a wall — not drawn; a
  falling one's shadow radius at `t < 0` is negative — `ellipse` throws.

## Hero sprites (`dungeon-sprites.ts`)

- **Ninja Adventure Asset Pack** (Pixel-boy, CC0; `public/dungeon/na/`, `CREDITS.txt`;
  taken via GitHub mirrors — the network blocks itch.io and opengameart). Character sheet
  64×112: columns down/up/left/right, rows 0–3 walk, 4 attack, 5 jump, 6 special. Effects —
  sheets 32 high, frame 32, the tail may be empty (`FX_FRAMES`).
- **Robe tier = a pack character recoloured by colour ROLES** (fur, quilted jacket, hard
  hat, armour, skin), not by brightness: T1 — northerner in a hood, T2 — soldier in a hard
  hat, forged T3/5/7 — knight in a helm, the rest — knight in a cloak. Skin is shared
  (`SKIN`); the hard hat is yellow, the lamp dark with bright glass, drawn by code in every
  frame that shows the forehead. Check on a sheet of all 8 tiers × 4 directions.
- **The pack's blades are drawn tip DOWN**: rotation `угол − π/2` (angle − π/2), hilt in
  the fist.
- **Steps follow distance travelled** (`h.walk / 0.36` cells per frame); direction with
  hysteresis (`dir4`), otherwise side/back flickers on diagonals. The blade is visible ONLY
  in a strike, charge and whirlwind; while charging a heavy — behind the shoulder.
- **Strike trail — the pack's crescent**, rotated to the strike angle and mirrored for a
  downward strike; the third hit — double, heavy — triple, whirlwind — a circle. Kill smoke
  is small and semi-transparent (otherwise a blot over the meat). `burst` particles remain.
- **Until the images arrive** — the old hero (`spritesReady`), `addFx` returns false and
  effects fall back to rings; loading starts at the cage (`useDungeonSprites`), portraits
  are redrawn on arrival.

## Tiles, maps, rats

- **The repository is PUBLIC — only CC0/CC-BY.** Rejected: 32rogues, Pixel Crawler, «Free
  Rat Pack» (forbids redistributing files). Tiles — 0x72 DungeonTileset II v1.7 (CC0, atlas
  512×512 `public/dungeon/x72/`, 370 frames; taken from a copy on GitHub). Crate and chest —
  from the atlas, other mining props — by code in its palette; rats — by code (no free pack
  has the needed poses).
- **Wall language:** above the floor a one-cell face, on top a 5-dot rim with separators
  every 7, counted from WORLD coordinates (otherwise a seam at the join); behind the rim
  dark rock without bright specks (they read as a starry sky).
- **The wall face follows the floor BELOW it:** above slabs — brick, above ground — rock
  with timbering. `,` on the map — the area's "other" floor (`floorLookOf`, `World.alt`). An
  item takes the floor look of most of its neighbours. Ground litter (`groundLitter`) — 1
  cell in 40, bare floor only.
- **Maps are edited only via the script** (`--write` rewrites `dungeon-maps.ts`, a rerun
  gives the same file byte for byte). The passage from the Устье grate to the Откатка cage
  must be SHORTER than the main path (387 vs 425), otherwise the grate gives nothing.
- **`MAP_VERSION`** (now 2): layout changed — exploration, lanterns, grates, stashes are
  reset, the run stands at the cage, the sack stays. Moved walls — bump the version,
  otherwise the hero wakes up inside rock.
- **Rats are parametric** (`dungeon-rats.ts`): poses idle 4, run 6, windup 2, bite 2, pain,
  death, sleep 2; `ratAnim` picks the pose by AI mode. Outline in ONE pass over the whole
  figure (otherwise the king's three-tail knot doubles). Since v2.103 floor 1's mobs are
  drawn by `f1-art.ts` (`dungeon-boss-anim.md`).

## Balance and rig

- **Balance is held by tests** in `dungeon-sim.test.ts`: Устье is passable at +2; Откатка
  without food at T2+0 kills (3 of 6), at T2+5 — doesn't; 190–400 kills per 5 min; the king
  at T2+3 falls in 1–4 min, at T1+0 he almost always wins. Change damage, health or spawns —
  the tests will tell what drifted.
- **Rig:** in dev mode `window.__dg` — the simulation, `window.__dgr` — the painter; the
  bot drives the hero with real keyboard events, smoothness — `__dgr.camY` offset per
  frame. The director feeds rats endlessly while the hero is at the burrows (intended): the
  bot walks and fights on the move, its distance field avoids timber props `P`; a mine cart
  can roll to the entrance of the Устье cage — lead the bot from the side. Loop "cage →
  Устье mine → cage" ~1 min.
- Frame measurements are from the rig (headless renders in software); not checked on a
  phone.

## Release index (grep `.claude/archive/dungeon-p1-history.md`)

v2.58 stage П1 (Устье and Откатка); v2.59 jitter, dash, slot sack, inventory, reforge
conditions; v2.60 Ninja Adventure sprites, exploration, upgrading below; v2.61 0x72 tiles,
maps 64 wide, chunks in `Px`, rats by code; v2.66 constant prices, lair door.
