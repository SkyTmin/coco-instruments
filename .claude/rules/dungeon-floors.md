---
paths:
  - "src/lib/dungeon-floors/**"
  - "src/lib/dungeon-{ai,sim,paint,render,brains,world}.ts"
  - "scripts/dungeon/**"
  - "src/lib/{inventory,creative}.ts"
  - "src/components/{Inventory,CreativePanel,DungeonRun,DungeonCamp}.tsx"
---

<!-- Working summary (v2.103). Release history, seeded bot balances, floor details —
     `.claude/archive/dungeon-floors-history.md` (not auto-loaded; grep by version or id). -->

# Dungeon: floors 1–15, floor engine, inventory, creative mode

## Structure

- **A floor is data; the engine is one.** `FloorDef` (`dungeon-floors/types.ts`), registry
  `FLOORS` (`dungeon-floors/index.ts`). Floor N: `fN.ts` (areas, monsters, boss, mines,
  meat, materials), `fN-brains.ts` (AI, boss script, floor rules), `fN-art.ts` (painters;
  there may also be `fN-mobs.ts`, `fN-boss-fx.ts`), `fN-map.ts` (export of
  `scripts/dungeon/fN.py` — don't edit by hand), `fN.test.ts`.
- **The contract is the bible `scripts/dungeon/README.md`** (§12б motifs 6–10, §12в
  «Движок 3» (Engine 3) E1–E19 and designs 11–15, §14 animations). Need an engine function —
  the integrator adds it; a floor doesn't edit the engine.
- **ids carry the `fN` prefix**; floor 1 keeps the old ones (`rat`, `king`, `skin`,
  `mouth`…) — saves rely on them. Don't change the ids of the entry area `fN`, the boss
  `fNboss`, the material `fNmat`.
- **Registries.** AI — `registerBrain(id, {step, onWall, onDeath, onHit, raw})`, boss —
  `registerBoss(id, {start, step, onPartDown, bar, notches, reset})`, floor rules —
  `registerFloor(n, {start, step})` (`dungeon-ai.ts`); drawing — `registerMobPainter`,
  `registerShotPainter`, `registerZonePainter`, `registerPropPainter`,
  `registerCellPainter`, `registerItemArt` (`dungeon-paint.ts`). Aggregators
  `dungeon-floors/brains.ts` and `art.ts`; **`art.ts` must be imported in the renderer,
  camp and inventory** — otherwise painters don't register and monsters are drawn as
  fallback circles.
- **Readiness.** A placeholder is `FloorDef.draft` (set by `stubFloor`); a real `fN.ts`
  doesn't set `draft` — the floor appears by itself once merged. The player sees ready
  floors consecutively from the first (`OPEN_FLOORS`), creative mode — all ready ones
  (`READY_FLOORS`); the stairs from the last ready floor are closed («этаж достраивают»,
  `floorReady`). Since v2.84 all 15 are ready.

## Floor engine API

- `Brain.onHit` — damage multiplier BEFORE the hit (front shield, "hit only the
  reflection", 0 — parried with a clang). `api.setTile` — a cell changes on the fly, the
  renderer redraws chunks itself (`sim.retiled`); each run has its own copy of `mark`.
  `api.moveHero` — teleport with an instant camera (`sim.warps`). `notches` — phase
  notches on the boss bar. Status `charm` — joystick and aim inverted. Test «движок для
  этажей» in `dungeon-floors.test.ts`.
- **«Движок 3» (Engine 3, v2.82.2)** — list with signatures in bible §12в, tests — the
  «движок 3» block in `dungeon-floors.test.ts`: `hurtHero`, `api.hurtEnv` (share of
  health, ignores armour), separate world and hero time (`api.timeScale`), custom
  slow-mo, hero pull, camera to a point, a mob falling into a chasm counts as a kill,
  friendly fire (`mobDmg`), ring arc and `los`, a lob with a puddle (`onLand`), floor
  actions («Действие» with a floor-specific caption), drawing above darkness,
  `shake`/`flash` events, `paintSim()`, `paintAll`, flat items, `flowR`, `reset` with
  `api`, the final ceremony `boss/finale`.
- **Sounds** of floor events — the `FLOOR_SOUND` table and suffixes
  `_call/_trap/_wall/_dive/_splash/_fall/_stone` in `DungeonRun`. `laserHum` is an on/off
  loop, don't call it as a one-shot event; `castWhoosh` is a fishing-rod cast with a plop,
  not magic. `boom`, `deepRumble`, `softChime` on events are temporary, not checked by ear.
- **Tall items become see-through** (v2.83, renderer): item taller than one and a half
  cells, hero north of its base and inside the image.
- **Missing from the engine** (floor requests): a "behind mobs but above darkness" layer
  (12, 13); a silent mob kill without hitstop (12); items on the fly (12); `api.zone`
  doesn't return the zone, no `api.hurtMob` (11, 15); no external force `api.push` —
  floor 11's wind moves `h.x` itself; `pullHero` without `over: true` over deep tiles (13 —
  its own rope); transparency of large mobs (13, 15); a "soft wall" and
  `nearestOpen`/`unstick` in the api (15); local time `api.timeZone` (14); a hanging
  projectile `Shot.hold` and projectile angle for the painter (14); per-mob time stop (14);
  `hitstop` stretches floor timers (14 — in tests this gave invulnerability); an
  `f11_spin_end` event; ice gates as door state, a hero speed hook (12 — sliding is done
  via a workaround); a quiet fallback look for a zone without a painter (now a red circle);
  `vNoTele` isn't cleared after an ambush.

## Pitfalls

- **Only the engine changes hero health**: `hurtHero`, `api.hurtEnv`, statuses and
  hazardous cells converge in `heroDown`, which knows about creative immortality and fight
  reset. Floor 9's tide wrote `hero.hp` itself and killed through immortality.
- **A run has ITS OWN copies of `mark`, `haz`/`hazards`, `lights`**: a floor that appended
  to `world.lights` accumulated light in the shared world across runs.
- **`setTile` pushes out of a new WALL, but not out of new deep tiles** — floor 8's bridge
  checks "who's standing" itself; auto-push would cancel the trap.
- **Mechanics that look for map cells — check the cells are where they're expected**:
  floor 11's guardian brain looked for `MK.vent` nearby, but all grates lay farther than
  220 cells — steam never fired once (v2.87: 8 grates in a ring in
  `scripts/dungeon/f11.py`). A bot on a stub won't catch it.
- **`useObject` is not a React hook**, but `react-hooks/rules-of-hooks` sees the `use`
  prefix; in floor tests import it as `useObject as operate`, otherwise CI «Lint» goes red.
- **Bot path test** on a changed map: the chaotic bot takes another route — threshold
  "3 of 4 seeds", not "all".
- **Multi-agent rig**: a shared `node_modules/.vite` via symlink gives two React copies —
  each agent gets its own `cacheDir` (config wrapper). A killed Vite doesn't free its port
  at once — start the new one on a neighbouring port.

## Descent, mines, levels, lift

- **Descent:** stairs `>` behind seal `S`; boss alive — wall. Victory raises
  `DungeonState.reached` and opens the next floor's entry lift (`applyDelta`);
  `descendRun` carries the run over with backpack and health. An old save with the king
  killed gets `reached: 2`.
- **A mine on every floor:** «Каторга» ores 2N−2 and 2N−1; rare whole blocks (`block:N`)
  and ore (`ore:N`) drop into the dungeon backpack.
- **Lift repair** `liftCost`: coins `LIFT_PRICE × (1 + уровень−1)` (уровень = level),
  material — the common one of ITS OWN floor (the old formula asked 2M coins on floor 9 —
  test «без миллионов»).
- **Levels:** floor N ≈ levels 2N−2…2N−1, but gear ends at T8+5 — from floor 6 everyone is
  level 9 and monsters grow via base `hp`/`dmg` (+15% per floor). When tiers 9–13 appear —
  assign levels. Balance of floors 2+ is by bots (T8+5 with food passes, boss 2–4 min;
  T8+0 without food dies), owner (quote): «подкрутим потом».

## Floors (designs — bible §12в; bot results — archive)

- 1 «Крысиные норы» (ratmen, shaman, traps, Король 2.0); 2 «Грибной грот» (Живые
  доспехи); 3 «Затопленная бездна» (curse of ascent, Алая пасть); 4 «Двойная крипта»
  (necromancer, statues, Каменный идол); 5 «Лабиринт» (living walls, Минотавр).
- 6 «Огненный разлом» (lava, collapsing bridge `setTile`, Красный змей); 7 «Зеркальный
  лабиринт» (mirror portals `moveHero`, Отражение built from the hero's sheet — in the
  shadow phase the real one is the one casting a shadow, the rest `onHit` → 0); 8
  «Бесконечный замок» (fusuma slide via `setTile` with a warning, Демон семи лун); 9
  «Лабиринт гидры» (teleport circles, a stump regrows as two unless cauterized with
  brazier fire); 10 «Трон демона» (gargoyles `ghost`, succubi `charm`, the arena edge
  falls away into the abyss).
- 11 «Небесный архипелаг» — WIND (the wind field moves hero, mobs, projectiles, loot;
  «СДУЛО» — 12% and return to solid ground; Древний страж, dome — damage ×0).
- 12 «Полярная ночь» (v2.91) — ICE: sliding via a workaround, thin ice in three stages,
  frost; mammoth with a shamaness, 4 phases.
- 13 «Театр марионеток» (v2.90) — STRINGS AND STAGE: Кукловод in four acts, the control bar
  (вага) is the weak spot. Known: in act II at the south edge he goes under the UI strip
  (hangs at y 8.6, the camera holds the hero) — only a per-floor camera offset fixes it;
  pendulums ~12 cells/s.
- 14 «Часовая башня» — TIME: «ЧАС» every 50–70 s (warning 3 s ahead, an "inhale" 2 s ahead
  under `timeStop`, which strikes 2 s after the call), the world stands still for 2–2.4 s.
  The «ОСТАНОВКИ» knife ring has a THROUGH gap (otherwise a knife from the far side hit the
  back). «ПОЛНОЧЬ»: a strong bot finishes the boss earlier — needs a guaranteed finale,
  shorten the strike to ~2 s.
- 15 «Ядро подземелья» (v2.93) — GRAVITY, `mapVer: 3`, music
  `{ explore: 'depths', boss: 'finale' }`. The bot dies in halls 77 (doesn't eat under the
  well's pull), 81, 82 — mechanics were not tuned for the bot.

## Floor 15 — two halves, a test holds the contract

- «Мир» (World) — `f15.ts` (assembles the `FloorDef`), `f15-brains.ts`, `f15-art.ts`,
  `f15-map.ts` (`scripts/dungeon/f15.py`); areas `f15` → `f15gut` → `f15veins` (old ids).
  `registerFloor(15)`: wells (pull on hero, mobs, projectiles, loot; projectiles bend), a
  "pull/push" lever, islands on orbits, weightlessness and heaviness, the telescope and
  the star door, six event halls.
- «Сердце» (Heart) — `f15-boss*.ts` (`scripts/dungeon/f15_boss.py`), area `f15heart`.
  Phases: ОТГОЛОСКИ (five echoes, sleeps invulnerable) → ПРОБУЖДЕНИЕ → ГРАВИТАЦИЯ →
  ПОДЗЕМЕЛЬЕ ПОМНИТ (quarters — lava, abyss, mirrors, hydra circles) → ЗАТМЕНИЕ →
  СВЕРХНОВАЯ → `finale`. For the rig — `f15bForce(sim, API, фаза)` (фаза = phase): the
  prologue can't be advanced via health.
- Seam — columns `F15_JOIN` 28–35; `seamBlend` (`f15-art.ts`) blends the top rows of
  «Пояс» into the night of «Ядро».
- Sounds — `f15_*`, `f15b_*` (quarters send `f15b_<kind>_trap`, the hydra —
  `f15b_warp_call`).
- Known: in phase 3 frame spikes from `retiled`; Хозяин's death is sped up ×2.3 — finale
  after 1.5 s (a finale after `linger` is needed).

## Inventory and bunk chest (`lib/inventory.ts`, `components/Inventory.tsx`)

One screen with all belongings by section, limits unchanged; the bunk chest in Барак 1
(27 slots, double — 54), an item returns where it came from. **Mine-backpack ore
deliberately can't go into the chest** — otherwise «Получка» (×2) would become a piggy bank
for thousands of blocks. The owner knows.

## Owner's creative mode (`lib/creative.ts`, `components/CreativePanel.tsx`)

- A separate sandbox save: while it's on, game keys (slots, «Каторга», forest, dungeon,
  fishing, chest) are written and read with the `creative.` prefix (`gameKey` in
  `makePersister` — the key is computed AT WRITE TIME); the real ones stay untouched.
- **Enter:** flush pending writes to the real keys → switch → sandbox (100M coins, 10M
  tokens, 999 keys, eggs, all floors, lifts and bosses, storage) → write everything → only
  then the `creative.state` flag. **Exit:** flush the sandbox → read the real ones → flush
  the sandbox again → switch and set the real state in one `set`. **No await between the
  flush and the switch** — otherwise a pending sandbox write lands in the real save.
- Immortality — `SimOptions.god` (a lethal hit leaves 1 health; from the next run). Entry —
  «Касса» and the wand button in the yard, owner only (in dev — everyone); when on, a
  «КРЕАТИВ» plaque mid-right. Rig check: enter, change rank, reload keeps the sandbox,
  immortality is on; exit and reload bring back the real state (rank, coins, tokens).
- **TP** (v2.88, `creativeWarp` in `dungeon-sim.ts`): «ТП к боссу» — outside at the gate
  nearest to K (you enter the fight yourself); a resting boss wakes up; during a fight —
  next to the boss. «ТП к лифту» — the nearest lift, an ongoing fight is reset
  (`resetBoss`), otherwise the gates would stay closed. Tested on all floors.

## Dungeon reset (v2.89)

- Owner (quote): «сбрасывай все подземелья. Играю только я один… просто тест провожу».
- `DUNGEON_SAVE_VER` (`dungeon.ts`): a save with a lower version → `DUNGEON_START`.
  `BUNK_MATS_VER` (`inventory.ts`): a chest with a lower version loses all `{t:'mat'}`;
  items, eggs, books and runes stay. The markers are independent — each blob decides on its
  own, the reset repeats on every load until the blob is rewritten; `persistBunk` always
  writes the marker. Wallet, «Каторга», slots, pets are untouched; an old copy restored
  from `/var/lib/coco/backups` is reset by the same check.
- **Always**: `normalizeDungeon` drops unknown ids from `kills`, `stash`, the sack
  (`knownMat`, `isMeat`); the chest drops unknown materials: a reworked floor may remove
  its old ids.
- **To reset again — raise BOTH markers.**

## Not verified

On a phone — floors, creative mode, all fights (rig 390×844 only); by ear — floor sounds.

## Release index (grep `.claude/archive/dungeon-floors-history.md`)

- v2.81 floors 1–5, inventory, creative; v2.81.1 placeholders hidden (`draft`);
  v2.82.0/.1 floors 6–10; v2.82.2 «Движок 3» (`heroDown`); v2.83–v2.84 floors 11–15,
  see-through items; v2.87 floor 11 steam grates; v2.88 creative TP; v2.89 dungeon reset.
- Reworks: v2.90 floor 13 (Театр, was «Город за стенами»), v2.91 floor 12 (Полярная ночь,
  was «Проклятая станция»), v2.93 floor 15 (Ядро, was «Сердце» with the lion), v2.95
  `seamBlend`.
- Animations: bosses v2.85–v2.97, mobs 2/3/5/4/1/7/6/9/8/10 —
  v2.98/99/100/101/103/105/106/107/108/109
  (`dungeon-boss-anim.md`).
