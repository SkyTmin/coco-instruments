---
paths:
  - "src/lib/dungeon-floors/f*-art.ts"
  - "src/lib/dungeon-floors/f*-boss-fx.ts"
  - "src/lib/dungeon-floors/f15-boss-*.ts"
  - "src/lib/dungeon-{paint,render}.ts"
  - "scripts/dungeon/{anim-sheet,boss-live}.mjs"
---

<!-- Working summary (v2.103). History of runs, reports, measurement tables —
     `.claude/archive/dungeon-boss-anim-history.md` (not auto-loaded; grep by version or id). -->

# Dungeon boss and mob animations

The motion reference is the hero's sword and dash: tempo (ease-out), arc, trail, contact
(hitstop, sparks, shake), afterimage. Contract and checklist: the bible
`scripts/dungeon/README.md` §14. Roles: «Тело» (Body) — the mob, or the boss and minions
(`fN-art.ts`, `fN-mobs.ts`, `f15-boss-art.ts`); «Техники» (Techniques) — markers, zones,
projectiles, contact (`fN-boss-fx.ts`); floor 15 also has «Мир» (World) (`f15-art.ts`,
`f15-rig.ts`).

## Engine (`dungeon-paint.ts`, `dungeon-render.ts`)

- **`MobFrame`** (all optional): `dx/dy` fractional offset; `sx/sy/rot` weight and tilt
  from the feet; `still` no windup jitter and no flyer bob; `lift` flyer height; `shadow`
  constant shadow; `lit` layer above darkness; `ghost` afterimage BENEATH mobs; `alpha`;
  `linger` long death (render keeps a copy of the removed mob); `img` may be an
  `ImageBitmap` — the engine only draws and tints it, `fr.img` has no `getContext`.
  `MobPose.now` — render time.
- `registerImpactPainter(art, {paint, life, shake, flash, above})` — custom contact instead
  of the generic particles. `frameLRU(limit)` — frame cache (don't create plain unbounded
  `Map`s). `registerMobWarm(paintId, gen)` — warm-up via generators, up to 3 ms per frame
  (`__dgr.warmQueue`, `__dgr.warmIt`).
- `api.vfx` — visual-only zone (id < 0), `above` — on top. `m.data.vNoTele = 1` — the
  engine doesn't draw the red marker and windup cone. A zone without a painter is a red circle.
- **Mirror `sx < 0`**: the frame is flipped at the anchor together with `lit`, eye and
  afterimage; no second copy in the cache. 8 directions = 5 drawn + 3 mirrored (`sx: −1`).
- **Death:** the world keeps the mob in `dying` for 0.7 s; longer needs `linger` (the copy is
  not in `sim.mobs`).
- **A crashed painter doesn't hang the game:** `DungeonRun` requests the next frame first,
  calls go through `guard` — a console line, the painter is disabled, fallback look.
- **"Ahead" frame** («на потом»): the next frame is drawn in advance, in slices, in its own
  buffers (0.45 ms per game frame — `mamAhead`/`rigTask` on 12, `lordAhead` on 13, `lAhead`
  on 14; `AHEAD_MS` on 3 — 0.3 ms, no more than two frames in a row); not finished — the
  rest at once; sheets with and without it match to the pixel. Lives inside the painter
  call (at 60 fps ~half a frame is ready). Cuts p99, not the mean; contact may lag up to
  33 ms. The beast and puppet rig is stepwise (`rigJob`).
- **New-frame budget** (floor 1, `F1_MOB_STAT.budget` 0.3 ms per frame): beyond it the mob
  keeps its previous frame. Warm-up stores attack frames as pixels (`PEND`), the canvas via
  `createImageBitmap` outside the render frame.
- **Mini-3D rig `f15-rig.ts`** — under floors 1, 3, 5 and the floor-15 world: an edit
  affects all of them.
- **Floor 15's echoes** are drawn by other painters (`f1_king`, `f1_rat`, `f2_shroom`,
  Минотавр, Змей, Гидра, Демон…) with their own mob and substituted modes: don't change id
  or anchor (Минотавр's canvas auto-shift moves the anchor too). Passes
  `dx/dy/sx/sy/rot/still/shadow/lift`, not `lit/ghost/linger`. Editing one — check the echo
  on a sheet.
- **Caches:** ≤400 frames per boss, `frameLRU(900)` on 14, mobs 1200–3420 per floor (cache
  per kind), floor-15 world 2400 (~24 KB per frame, ~58 MB). Floor caches are not cleared on
  descent — don't raise the caps. Repeating images (moon, clouds) also go in `frameLRU`.

## The brain is the metronome («Мозг — метроном», hard rule)

- Don't touch timings, damage, radii, mode names. Brain edits are drawing only (`api.vfx`,
  `m.data.v*`, `above`, shake), each line marked
  `// <выпуск или «анимации N»> — только рисунок` (release or "animations N" — drawing
  only). Floor tests are not edited; seeded bot fights match before and after. **Contact
  frame = damage frame.**
- **No `api.zone` and no `sim.rng()` in drawing code**: `api.zone` takes `sim.nextId`, and
  mob numbers decide which side a pack comes from; `sim.rng()` shifts combat randomness.
  Variety — via a phase from `m.id`.
- Old picture-zones on `api.zone` (`f9_necks`, `f9_flame`, `f10_command`,
  `f6_waveflame`…) must not be moved to `api.vfx` — that shifts `nextId`; they may only get
  `above`.
- The brain has no hit event — put `api.vfx` right in the damage lines (marked). First look
  for hits the brain already emits without a painter (`f4_rise`, `f4_blink`).
- **A "this is the real one" tell in the drawing is a gameplay change** (floor 7's Отражение
  copies are identical, only the shadow gives away the real one).

## Pitfalls and lessons

Merging (agents can't see each other — the integrator catches these):
1. **One object twice** — in the frame and in a zone, or a second `register*Painter` for the
   same id in the effects file (floor 9's hydra tail — kept `f9_tailfx`: shows the strike
   sector; floor 12's temple bowls, Кукловод's strings, floor 13's lasso and needles — kept
   "Body").
2. **A shared type extended by one side** (`LordPoint`) — type error on merge. Conflict in
   `fN-brains.ts` — keep both sides.
3. **Points come from the rig and shared functions, not from frame fields**: the guardian's
   3D rig sets `eye: null`, the beam flew from the sprite's middle → `f11GuardPoints`. A
   frame-based point accounts for the mirror `sx < 0` (`serpentMouth`). Without shared
   points before launch, strings detach from the hand.
4. **Dying zone:** `f6_body` plays out death for 1.7 s; code that looks a zone up by id
   without checking picks it up, and the new `api.zone` gets created later — `nextId` shift.
   For the living — a zone without `vDie`.
5. **`above` zones are clipped by silhouettes, including the `linger` copy** (not in
   `sim.mobs` — position from the painter, `lordSeen`), by the last frame's points (a
   rectangle gives a "step" at the head). Everything on the floor above darkness — clipped
   by bodies (`clipBodies`).
6. **Drawing = damage geometry and timing:** `f13_gridline` was drawn from −L to L and
   blocked the passage (the hit is a ray 0..L); floor 14's knife line appeared before the
   knife arrived (delay `knifeDelay` + `KNIFE_FLY`); the toad's tongue — 0.1 s before the
   hit, length from `lineHits`.
7. **`api.vfx` ids are negative:** `z.id % n` < 0 (idol: `RUNES3[…]` → `undefined`).
   Use `((x % n) + n) % n` or `>>> 0`.
8. **Row-fill sentinel** −1 with x from −R lost the left half of the shape (`NO_RUN` on
   7/10/14). Sentinel −1e9.
9. **`lineOfSight` from the center of a wall cell** hits the wall itself (floor 15's mirrors
   didn't shoot) → from the cell edge toward the hero (`mirrorEdge`, test «зеркала четверти
   стреляют»).
10. **Mechanics that look for map cells** (`MK.vent` on 11) — check the cells are there; a
    bot on a stub won't catch it.
11. **Custom modes — a 24 fps track from `pose.t`**, not the shared idle/run counter (the
    windup flickered at 4–13 Hz); windup over the whole windup with `still`, not 2 frames
    and ±1 px shake.
12. **Time stop:** the brain's clock stops — drive living things by `sim.scaleT`. The
    engine's grey-out tints the boss; floor 14's workaround — `queueMicrotask` after the
    frame and a `saturation` fill in an oval, fragile (grey must be the last layer).
13. `f15_life` (`api.vfx` per run) must be set again after `resetBoss` — it clears zones.
    `retiled` redraws 9 chunks per cell — cache expensive area cells.

Warm-up and cost:
14. **Warm up everything that plays:** mirrors (`frameOf` stores the mirror too), deaths of
    every kind, sideways and backward walking, special idles. Without it floor 3 cost ~1 ms
    p90 more than base. Variants (elite, albino) — from the ready frame via canvas ops in a
    separate cache (~35% of the kind's limit), otherwise they evict warmed frames (floor 7's
    albino spider: 44 new frames in 8 s, p90 1.5 ms).
15. No per-phase warm-up: after a phase change frames are built in combat (peaks up to
    75 ms). Split generator steps: in the floor-15 world a step reached 13–18 ms with a
    budget of 3.
16. **Measure crowds only after warm-up** (it runs in `frame()`, 15–20 s under load, base
    doesn't pay it): `__dgr.warmQueue.length === 0` and `!__dgr.warmIt`, `WAIT=20–30`.
    **Count new frames in combat by cache keys** — that exposes unwarmed mirrors and actions.
17. Cheapest of all — crop the canvas to the drawing. `lighter` layers make light
    compositing expensive. An enchant halo on a foreign mob — a shared canvas, not a new
    frame.

Mob painter and rig:
18. The bestiary portrait (`dungeon-mobart.ts`) calls the painter with a mob without `id`,
    `vx`, `kx` → `m.id ?? 0`, otherwise NaN.
19. A sheet makes a new mob for every frame — "from the previous mode" transitions are seen
    only live.
20. `linger` plays without a brain — sounds on death frames via `setTimeout` from the event.
21. Editing a file under a running Vite gives a second module instance (`?t=…`), `F13_FX` is
    empty for sheets — restart Vite.
22. An agent can't merge the integrator's branch into its worktree («Modify Shared
    Resources») — the integrator merges; an agent may have created its own branch — merge
    it by the name from the report.
23. API limits and container restarts cut everyone off, Vites die: work is intact in the
    worktree, continue via `SendMessage`; commit after every step.
24. Disk fills up from agent folders (scratchpad 21 GB): Chromium «Target crashed»,
    `ERR_INSUFFICIENT_RESOURCES`, `df /` ≈ 0 — delete folders of checked-out releases.

## Owner's rule: bosses don't walk sideways (since v2.90)

The old floor-15 lion moved sideways like a crab: muzzle facing the camera, legs walking
across. Owner: «это фу» (quote; "yuck"). For every boss and its large minions:
- the body faces where it goes, leg steps follow the distance travelled;
- needs to turn — turn first (`faceTo` with a speed limit), then move; on a sharp turn it
  nearly stops (`along = max(0,15, cos(Δ))`, movement along `m.face`, not along the path)
  — as with floor 13's giant (v2.90.1) and Кукловод in act IV;
- a carried flyer (Кукловод on strings) doesn't step: legs and coat-tails lag by inertia,
  the torso leans into the motion;
- check — walk and flight frames in 8–16 directions on the rig;
- since v2.93 floor 15's Хозяин is a legless astral lord: hovers, turns no faster than
  `LORD.turn`, the cloak lags by inertia, sheet — 32 compass points.

Mobs also walk where they face (floor 1's slinger and man-at-arms — body at ±45°, step
back). Exception — floor 3's crab walks sideways on purpose: claw shield toward the hero is
a mechanic.

## What made 12–14 the reference (checklist)

- every technique — a 24 fps track, contact frame = damage frame (per phase if tempos
  differ); anticipation → strike → follow-through → recovery; the command gesture precedes
  the minion's strike;
- movement along the path, 16 directions, steps over when turning; core and shoulders
  first, the cloak catches up;
- secondary motion (trunk, ears, ribbons, coat-tails, sleeve) — same keys with an offset
  (2/4/1 ticks), overshoot and a decaying swing on stopping;
- windows — as scenes; the weak spot glows ONLY when the brain grants extra damage; rim
  light from top-left, details' `lit` weaker than the weak spot;
- `ghost` — only on fast strikes; flash on the boss is soft (32% of the colour, not white);
- death — a 2.6–5.2 s scene via `linger`;
- "Techniques" markers close in toward the strike, the last 0.2 s white, on the floor
  occluded by bodies; contact in two layers — floor (`registerImpactPainter`) and above
  darkness (`api.vfx` with the same id and `above`, `warn` = flight time, or `lit`); shake
  by strength (0.05–0.45);
- "ahead" frames, warm-up, frame p90 no higher than before (benchmark — floor 14).

## Reference recipe (12–14) — keep doing it this way

Owner after v2.97.0 (quote): «Просто идеально божественно… 12, 13, 14 этажи очень сладкие,
очень вкусные, очень красивые. Эталон!» How this work was done:

1. **Before launch the integrator sets up shared body points** — from the last drawn frame,
   with fallback points until a frame exists. "Techniques" place effects by them, the
   integrator clips layers. Existing: `mamPointPx(m, 'drum'|'tusk')` (the tusk pixel is
   empty by contract), `lordVagaPx`, `giantShoulderPx`, `lordPointPx(m, which)`,
   `lordHandPx(m, side)`, `crownSpot`, `serpentMouth`, `f11GuardPoints`.
2. **Brief = shared template + floor-specific head.** A «Эталон» (Reference) section with
   code (`mamFrame`/`mamAhead`/`rigJob` of floor 12), hard rules only where a mistake breaks
   the game (brain — drawing only, marked; `api.vfx` without `sim.rng()`; floor tests), one
   review pass over own sheets, report form — a technique table "action → frames → contact
   frame → engine fields" plus measurements.
3. **`artist` agents in worktrees, in background**, with wip commits and notes; cut off by
   a limit — wake the same one via `SendMessage` if idle for less than an hour.
4. **Merge:** `merge --no-ff`; look for duplicates (one object both in a frame and in a
   zone; two `register` calls for one id; a shared type extended by one side); check layer
   order — `above` zones are clipped by silhouettes, including the `linger` copy.
5. **Verification:** tests, build, eslint, prettier; live recordings of all phases and
   death, frames enlarged; A/B of frame cost against base, alternating, after warm-up
   (`WAIT=14`), noisy phases — repeated.
6. **Sound — only for new events**, nothing that can't be checked by ear.
7. **Docs — only numbers verified from logs.** Roll out per floor. Report to the owner —
   honest measurements and what wasn't checked on a phone and by ear.

## How to staff agents (since v2.96, per claude.dev articles)

- **The author doesn't review.** A model is biased toward its own output, and "three
  rounds of self-critique" in a 300–700k context are an agent's most expensive turns. The
  brief has one review pass over own sheets; after hand-off a separate `artist` agent with
  a clean context checks the sheets against "What made 12–14 the reference" (section
  above) and returns discrepancies; the author or a new agent fixes them from a note.
- **Brief = pitfalls, lookup info and reference code**, no repetition, nothing obvious.
  Hard rules only where a mistake breaks the game: the brain (drawing only, marked),
  `sim.rng()`, `api.zone` vs `api.vfx`, floor tests. Mandatory rituals (double-check, an
  N-step procedure) are wasted turns.
- Bosses — a "Body" + "Techniques" pair on a shared base; mobs — one agent per floor.

## Rigs and measurements

- `anim-sheet.mjs` — 24 fps sheet with the damage frame marked; a row takes `face`,
  `vx/vy`, `kx/ky`, `look`, `id`. `boss-live.mjs` — live fight recording (frames, sheet,
  mp4), hero right next to the boss; `bossNew` counts "ahead" frames too; the window
  follows the mob position, not the drawing. `mob-live.mjs` — the floor's crowd in a ring
  (`MOBS=вид:число,…` = kind:count, `RING`, `AT`, `ELITE`), recording or `MEASURE=1`
  (p50/p90/p95/p99). Shared: `FLOOR`, `SECS`, `WAIT`, `ATTACK=1`, `DMGK` (0.05 — nobody
  dies, 5 — deaths), `SETUP` (a JS string); Playwright — `PLAYWRIGHT_MODULE`, Vite — `PORT`
  (5201). Everything is in the file headers (`scripts/dungeon/`). Floor 15 phases —
  `f15bForce(sim, API, фаза)` (фаза = phase).
- **A/B:** base and new alternately, 3–8 pairs, after warm-up, with load average; "within
  noise" — ranges overlap. Rig benchmarks: floor 14 fight p90 ~3.1 ms; a new boss frame
  0.5–2 ms (heavy ones 3–6 — warm-up saves it), a mob 0.2–0.8 ms.
- Sheets enlarged: all directions, phases, deaths. What you didn't touch (the boss while
  working on mobs, neighbours when editing the rig) must match before and after to the
  pixel.
- Rig 390×844, headless renders in software; not checked on a phone or by ear — say so.

## Known issues, requests to the engine (not done)

- The engine lacks: a "behind mobs but above darkness" layer; two-layer contact in one
  call, with `from`/`kind` in it; a tip point and `lit` offset in `MobFrame`; hero-hit
  flash on the body only (`flash` is set even on a parried hit — floor 11's dome whitens
  the guardian); a shake cap per window; per-phase and idle-time warm-up; grey-out with a
  per-mob exception; floor cache reset on descent; per-floor camera offset; `boss-live`
  window by the drawing.
- Shortcomings of bosses and mobs (13, 14, 15, 4, 2) and sounds proposed but not added —
  the «Известное» (Known) sections in the archive. Don't add sounds without checking by ear.

## Release index (grep `.claude/archive/dungeon-boss-anim-history.md`)

- v2.85 bosses 1–5, engine created; v2.86 bosses 6–10, effects in `fN-boss-fx.ts`
  (`f6_body`, `serpentMouth`, `f8v_dir`, `f9_tailfx`); v2.87 bosses 11–15
  (`f11GuardPoints`; 12, 13 and the floor-15 lion were later redone).
- v2.90 the "no sideways walking" rule; v2.92 Кукловод 13 (`lordVagaPx`); v2.94 mammoth 12
  (`mamPointPx`, `mamAhead`, `rigJob`) — the reference; v2.95 floor 15 finale
  (`lordHandPx`, `f15-rig.ts`, `f15_life`, `mirrorEdge`); v2.96 Кукловод-2 (`lordAhead`,
  `f13_v_*`); v2.97 Повелитель-2 (`lordPointPx`, `lAhead`, `clipBodies`, `lordSeen`).
- Mobs: v2.98 floor 2 (`f2-mobs.ts`, `mob-live.mjs`), v2.99 floor 3 (`f3-mobs.ts`), v2.100
  floor 5 (`f5-mobs.ts`), v2.101 floor 4 (`f4-mobkit.ts`), v2.103 floor 1 (`f1-art.ts`,
  `F1_MOB_STAT`), v2.105 floor 7 (`f7-mob-*.ts`, `f7-mobkit.ts`: `visOf`, `hurtFx`, `dress`),
  v2.106 floor 6 (`f6-mob-*.ts`, `f6-mobkit.ts`, `f6-mob-fx.ts`), v2.107 floor 9 (`f9-mob-*.ts`,
  `f9-mobkit.ts`; `f9_body`/`f9_head` stay registered for floor 15), v2.108 floor 8
  (`f8-mob-*.ts`, `f8-mobkit.ts`, `f8-mob-fx.ts`, brain `f8_snap`), v2.109 floor 10
  (`f10-mobs.ts`, `f10-mob-*.ts`; zone `f10_puff` and the imp's in-frame smoke both kept).

## Floor 14 mobs (`f14-mobkit.ts`, `f14-mob-<kind>.ts`)

- Ten kinds, one file each; `f14-art.ts` keeps only props, zones, shots and `deathK`/`clear`/
  `scatter`/`spring` (imported by the mob files lazily — circular import, never call f14-art at a
  mob file's top level). Rigs with 8 honest sides (soldier, sand, rewinder, reaper, keeper,
  beetle, smith); the double = the hero's own 4-side sheet in sepia («hero of the past»); the
  cuckoo = 5 sides (the brain's `m.dir` is the south half only); the weight = a 2D cylinder.
  Cuckoo and weight draw a per-mob composite canvas (spring / chain / shadow change every frame),
  only the body and ground frames are cached.
- Kit = f10 kit + `wnow`/`idlePh` (world time: the «ЧАС» stop freezes `m.t`, idle must freeze
  too), `sideOf` (8 sides with hysteresis), `keyPose`/`mixPose`, `lookFrame` (elite, albino, gray
  sepia = «frozen time» — statue, Stop-frame), `SHEET_PREV` (append-only), `F14_MOB_STAT` /
  `window.__f14stat()` (`battle`, `sizes`, `wcost` per kind).
- **Floor warm queue (`regWarm`, `demOf`).** The engine warms one kind at a time, in `sim.mobs`
  order, only kinds already present: a kind arriving while another warms (sand and rewinder at a
  clock while the reaper warms) built its frames in combat. Every kind registers through
  `regWarm`: a live miss in `frameOf` queues the whole series (pose, side) from the next frame and
  puts the kind into the shared queue, drained by whichever floor-14 generator the engine runs.
  Late-arrival scenario (reaper, then 2 sands + 2 rewinders after 4 s): 580 → 73 frames built
  during warm-up; after it 0. `__f14mob.sched = false` = old engine order (stand only).
- Brain: 3 drawing-only lines for the double (`vAng`, `vHeavy`, `vStomp`). Soldier stays the
  floor-15 echo source (`f15_echo` changed with its drawing in step 1, then pixel-equal).
- Measured: whole floor 10 122 warmed frames + 61 gray, 17.4 MB (keeper 4.2, rewinder 3.0, reaper
  2.6, soldier 2.4, sand 1.7, double 1.6, beetle 0.7, smith 0.5, cuckoo 0.4, weight 0.3), all under
  caps; warm build p50 0.2–0.5 / p90 0.3–1.4 ms (crowd load). 0 frames built in 8 s of combat after
  warm-up: 18-mob crowd, deaths (DMGK 5 and staged deaths of all ten kinds), sand/rewinder at a
  clock. All-elite crowd: 137 recolours in 8 s after a 60 s wait, p50 0.2 / p90 0.4 ms (looks not
  pre-warmed, as on 11/12). Crowd A/B vs v2.109, base → new, WAIT 90: p50 2.9→3.2, 2.7→2.6,
  2.8→2.7, 2.6→2.7; p90 3.6→4.5 (10 mobs near vs 8), 3.7→3.7, 3.7→4.1, 3.4→3.8; p99 6.6→7.6,
  7.4→7.9, 7.2→7.8, 5.9→6.7; WAIT 40 pair 2.6/3.8/5.4 → 2.6/3.7/6.1 ms. Mob draw calls ~0.35 ms
  per frame in both; p99 sits +0.5…1.0 ms higher in every pair (not traced). Boss `f14boss`,
  `boss-hour` pixel-equal to v2.109 (numpy, all channels).
- Gotchas: a long `WAIT` without `s.god` set at once — floor events kill the hero and every mob
  freezes (`heroDown` returns before the brain); the crowd thins out over 90 s (mobs near 3–10),
  so A/B pairs differ in load; sheets assume frames above the anchor — a mob drawn below it
  (cuckoo peck) needs a `strike` line; the double's sheet needs the hero sprites loaded.
