---
paths:
  - 'src/ui-px/**'
  - 'scripts/ui-px/**'
  - 'public/ui/kit/**'
  - 'src/components/Nursery.tsx'
  - 'src/components/nursery.css'
---

## Pixel UI kit — style guide (v2, 13.10.2026) — `src/ui-px/`, `scripts/ui-px/`

Owner: redraw the whole game interface in the style of the bosses and pets (pixel art, 1-px dark
outline, light from the upper left), «no walls of text», every format (phone portrait/landscape,
tablet, desktop) and every input (touch, mouse, keyboard, gamepad). The Nursery (`Nursery.tsx`)
is the pilot; other screens move to the kit one by one. References and what we took from each:
agent note `{SCR}/REFS.md` (Genshin archive, Hades keepsakes, Clash Royale deck, Stardew,
Moonlighter, Darkest Dungeon, Octopath, Diablo, PoE2). Study only — never copy pixels.

### Grid and scale

- **One art pixel = `var(--u)`** = `var(--ui-px)` from the shell (S: `--ui-scale` 2 phone, 3
  tablet/laptop, 4 at 1080p, 5 at 1440p+). Every size, border, gap and offset is
  `calc(N * var(--u))` with integer N. Never px for art, never fractions of `--u`.
- **No CSS rotate/scale of pixel art** except integer steps (×2, ×3). Motion = `translate` by whole
  art pixels, `steps()` timing, opacity. No blur, no soft shadows on art (text shadow = 1 art px
  hard offset in `--px-ink`).
- `image-rendering: pixelated` on everything baked; frames/icons are PNG at 1 px = 1 art px.

### Frames are drawn in code and baked

- Painter: `src/ui-px/paint.ts` (pure TS, deterministic): `MAT` ramps, `frame()` (rounded-rect
  ring by BFS depth: outline INK → dark → mid → light bevel on the upper-left, shadow lower-right),
  decorations (stone cracks, rivets, wood grain), buttons in 4 states, rarity slots, focus/select
  rings, tabs, trough, badges, keycap, ribbon, stone tile, pedestal, 9×9 icon masks (`ICONS`).
- Bake: `npx vite-node scripts/ui-px/bake.ts` → `public/ui/kit/*.png` (64 pieces, ~7.6 KB) +
  `src/ui-px/kit.gen.css` (GENERATED — don't edit). The bake MEASURES each 9-slice from the pixels
  (`measureSlice`: the centre must be one colour, stretched edges uniform) and exits 1 when the
  declared `slice` differs — the `game-ui.md` lesson «срез равен канту картинки» as a check.
- CSS per frame: `--pxk-NAME` (url with content hash), `--pxk-NAME-s` (slice + fill), `--pxk-NAME-w`
  (widths as NUMBERS = multiples of `border-width`, which the kit sets to `var(--u)`), class
  `.pxk-NAME`. Icons: `.pxi-NAME` (mask, colour = `currentColor`). Images: `--pximg-NAME`, `-w`, `-h`.
- **Pitfall:** the `border` shorthand resets `border-image` — set `border-width/-style/-color`
  longhands only. State switching goes through `--b/--bs/--bw` vars (buttons, slots).
- **Pitfall:** a frame's `fill` paints its centre OVER the element background — a stage with a
  floor tile looked flat. `Panel stage` adds `px-nofill` (generated `.pxk-NAME.px-nofill` = slice
  without `fill`). Text over the tile: a flat veil (`linear-gradient` of one colour) + ink shadow.
- Defaults use `:where()` (zero specificity) so variant classes win regardless of order.
- New piece: add to `PIECES` with its declared slice, bake, run `npx vitest run src/ui-px`
  (`paint.test.ts`: slice = measured, deterministic, icons 9×9 white, no half-alpha, unique names).
- Several agents append pieces at once: add yours in a `// wave N — <letter>` block at the END
  of `PIECES` / `ICONS`, never reorder; on a merge conflict keep both sides and re-bake.
- Wave 2 — C added `tab-side-on` and the icons gear, sound, mute, music, nomusic, question,
  excl, minus (for `KIcon`); `key` was redrawn upright (ring bow, shaft, two teeth) — the old
  one read as a blob.

### Materials (5-tone ramps, dark → light; INK `#120a0e` outline everywhere)

Palette v2 (wave 2 — N, 13.10): LIGHT and warm, so text and art read («на её фоне не особо всё
хорошо видно»). Ramps in `paint.ts` `MAT`; re-bake after any change.

| material                 | ramp                                      | use                                   |
| ------------------------ | ----------------------------------------- | ------------------------------------- |
| stone (sandstone)        | `#6b5238 #a08462 #c4a985 #e0cba8 #f8ecd2` | stages, showcase, mine screens        |
| iron                     | `#1a1e25 #2a3039 #404853 #5e6875 #8e99a7` | secondary buttons, tools, forge       |
| wood (oak)               | `#3a2010 #6b3f20 #94592e #bd7a3e #e3a25c` | windows, sheets, the camp frame       |
| parchment                | `#73502c #a27b4b #caa56e #e3c893 #f5e5bb` | readable text blocks, books           |
| obsidian (= interior)    | `#6a4526 #f0dfba #e4cc9c #c9a56d #fff6e0` | fill of frames, wells, slots, details |
| gold / red / green / ash | see `MAT`                                 | primary / danger / confirm / disabled |

- **`obsidian` is the interior ramp of everything** (well, slot, inspect, tooltip fills), now
  light parchment (`#f0dfba` fill, `#e4cc9c` well) — not a dark material any more. The name stays
  so the bake/pieces don't change.
- **Text vars are ink by default** (light surfaces): `--px-text #2a190c`, `--px-muted #5a3d22`,
  `--px-dim #6e5034`, `--px-gold #804400`, `--px-red #a52a1a`, `--px-green #255c18`,
  `--px-blue #1d5a96`, `--px-violet #6236a8`. On a DARK surface (iron/dark wood button, ink name
  plate, red ribbon) put **`.px-dark`** on the container: the same vars become cream
  (`#fff4dc #ecdcbc #d4c2a3`, gold `#ffd25e`, red `#ffa78c`, green `#9be887`, blue `#a6d6ff`,
  violet `#d8c0ff`). Screens of other agents that sat on dark panels need `.px-dark` there.
- **Measured contrast** (script `{SCR}/contrast.py`, every pair ≥ 4.5:1 for body, ≥ 3 for bold
  ≥ 18.7 px): ink on fill 12.8, on well 10.8; muted 7.5/6.3; dim 5.6/4.7; gold 5.8; red 5.4;
  green 6.1; blue 5.4; violet 6.1; `.px-dark` cream on dark wood 8.2, on iron 8.5, on ink plate
  15.5; primary button ink on gold 7.9; danger/confirm cream on red/green 4.3/3.3 (bold 20 px).
- **Rarity colours are never plain text on light** (common on fill = 1.4:1): use an ink pill
  (`.nur-rar`: ink on the rarity colour, ≥ 7:1), the colour on an ink plate (≥ 6:1), or a name
  with a 4-direction ink outline (`.px-inspect__name`). Slot frames keep the colour (inside an
  ink line).
- Tabs have fixed colours (not text vars): off = `#efe2c4` on iron, on = `#2a1405` on the wood
  face. Slot counters / ★ are white with a 4-side ink outline (readable on light and dark).
- Rejected (shots `{SCR}/palette-variants.png`): v2 walnut — stone `#4a3a2e…#eadbc0`, wood
  `#2e190c…#d08e4c`, interior `#1a110b #46301f #3b281a #6b4d36 #94704f`; v3 slate — stone
  `#3c4458…#e4eaf4`, wood `#22170f…#a07a52`, interior `#11151d #2c3446 #253041 #465370 #6d7c9e`.
  Both kept dark wells where pet thumbnails blur; v1 (above) has the highest body contrast.

Light comes from the UPPER LEFT: bevel highlight on top+left, shadow on bottom+right, buttons are
3 px deeper at the bottom (pressed = the face moves down 2 px, bottom lip gone).

### Rarity

Slot frames `slot-r0…r6` and name colours come from `lib/rarity.ts` (`RARITIES[i].color`) — never
only text. Locked/unknown = silhouette in the same cell (`PetArt ghost`, grey on the light slot well,
black on the stage) + small lock bottom-right.

### Type

- Owner 13.10: the pixel fonts (Tiny5, Press Start 2P) were «непонятный, сложно читаемый»; they
  are GONE (files, `@font-face`, OFL texts). Body = **GxRubik** (`--px-font`, the game's vector
  Rubik, weight 500, `b/strong` 700, `font-synthesis: none`). Headings = **Russo One** subset
  renamed **«Coco Title»** (`--px-head`, `/ui/fonts/coco-title.woff2`, OFL in
  `public/ui/fonts/OFL-coco-title.txt`; built by `python3 scripts/ui-px/fonts.py <dir with
RussoOne-Regular.ttf>` — subsets Latin + Latin-1/Ext-A + Cyrillic, renames, FAILS on a missing
  glyph of the 7 languages). Numbers: `.px-num` = Rubik 700 tabular (nothing jumps).
- Why Russo One (side by side at 20–28 px, DPR 1/2/3, 7 languages, `{SCR}/fonts*.png`): game
  character, wide clear Cyrillic, full Turkish/German; Exo 2 / Oswald readable but plainer or
  condensed; Philosopher too thin; Rubik 800 readable but no character. Only headings/names
  use it — body text stays Rubik.
- Scale (vector, not whole pixel steps): `--px-fs = (15px + 2.5px·ui-scale) · --px-tx` →
  20 px on phones (scale 2), 22.5 tablet/laptop, 25 at 1080p. Owner set «large» and liked it,
  so this default is ≥ the old «large». `--px-fs-sm` ×0.85 (labels, ≥ 17 px), `-tiny` ×0.7
  (ONLY digits on slot counters/key caps), `-head` ×1.15, `-big` ×1.3, `-hero` ×1.4.
  L's setting `html[data-text=s|l]` → `--px-tx` 0.87 / 1.15 (one step smaller / larger).
- Heading = `.px-h` (Coco Title, `--px-gold`, 1-art-px ink shadow). Pitfall: `game-ui.css`
  `.gx-panel--wood :is(h2,h3,b)` puts its own shadow/colour on headings inside the camp sheet —
  scope kit headings one class deeper (`.nur .nur-…`).
- Never ellipsis on primary labels (buttons, tabs, titles): wrap or a shorter string; check
  de/tr at 390×844. Long names fit by size, not by cutting: `font-size: min(hero,
100cqi / (len · 0.64))` in a size container (`--len` = name length).
- Short labels; numbers via `fmtNum`/`t()` params (locale thousand separators).

### Spacing

Gaps 1/2/3/4/6 art px; panel padding = frame thickness (stone 6, wood 8, obsidian 5, parch 3);
slot 26 × 26 (`--slot`), small button min 15 × 15, button min 19 high.

### Components (`@/ui-px`)

`Panel` (material, `stage` = stone floor tile), `Button` (primary gold / secondary iron / danger
red / confirm green; `size="sm"`, `icon`, `on` toggle, `off` = aria-disabled but tappable to
explain, `hint` = key prompt), `Tabs` (tabPrev/tabNext = Shift+Tab/Tab, LB/RB; shoulder prompts on
gamepad; wave 2 — C: item `art` (any node instead of a kit `icon`) and `name` (aria-label +
`data-tip`, so an icon-only tab still says what it is), the label in `.px-tab__label`;
`vertical` = a rail (`px-tabs--rail`, selected piece `tab-side-on` joins the panel on its
right); `main` = the window's own row — an inner `Tabs` in the same `[data-ui-layer]` then
passes tabPrev/tabNext on and hides its key hints, else the later-registered inner row eats
LB/RB and the player is stuck), `Slot` (rarity frame, `selected`, `locked`, `empty`, `count`, `corner`, `dot`, `tip`),
`Grid` (equal cells, auto-fill), `Bar`, `Badge`, `Heading` (`ribbon`), `Icon`, `KeyHint` (S's
`<Prompt>` in a pixel keycap), `Tooltip`/`useTip` (mouse hover 300 ms, long press 450 ms on touch),
`Inspect`/`InspectRow`, `Modal` (portal, `data-ui-layer`, escape stack, `sheet` = docked bottom on
phones). Gallery for the stand only (not built): `http://127.0.0.1:<port>/scripts/ui-px/gallery.html`
(`?kbd=1`, `?pad=1`, `?modal=1&sheet`).

### States (buttons, slots, tabs)

normal → hover (mouse only, `@media (hover:hover) and (pointer:fine)`: one ramp step lighter) →
pressed (`.is-down`, set on `pointerdown`: face 2 px down; a slot's well one ramp step darker and
its art 1 u down) → **focus: very visible** — a 2-px gold double ring
OUTSIDE the element (`.px-f::after`, `--pxk-focus`), shown for `:focus-visible` and S's
`[data-focus]` (gamepad), louder than hover and than `selected` (white ring with gold corners) →
disabled (`aria-disabled`: ash material, still clickable to show why).

**Press is visible in the first frame (wave 3 — N2).** `:active` came 80–90 ms AFTER release on the
stand (touch, 4× throttle) and never on a slot. `usePress(ref)` from `@/ui-px` puts `.is-down` on
the element by `classList` in `pointerdown` (no React render), clears it on window `pointerup`/
`pointercancel`/`blur`/`scroll` (capture) and on `pointerleave`, and a layout effect re-adds it if a
re-render rewrote `className` mid-press. `Button`/`Slot` use it and still call your own
`onPointerDown`/`onPointerLeave`. Any custom button outside the kit (`.gx-round`, `.hub-pad`,
dock) → `usePress(ref)` + a `.is-down` rule; no transition on the pressed state.

### Input and formats

- Focusable things carry `px-f`; the shell moves focus spatially (arrows/D-pad); first focus →
  `data-autofocus`. A list where focus = selection (Nursery grid) selects on `onFocus`.
- Hotkeys via `useAction(…, { scope })` so they die when a window covers the screen; show them
  with `hint`/`KeyHint` (nothing on touch).
- Layout by S's format: `useFormFactor()` → `ff`, `landscape`, `scale`. The showcased thing is
  about HALF the screen (owner): phone portrait — stage on top (~55 % of the height), compact
  rows under it, actions in the thumb zone; phone landscape / tablet landscape / desktop — stage
  | side column (~50 % of the width); tablet portrait — stage on top, side below. Each column
  scrolls on its own; the page never scrolls. No dead strips: grids spread spare width between
  columns (`justify-content: space-between`).
- **Never give a grid child a `grid-area` name its parent doesn't define** (e.g. a block reused in
  two containers): the browser adds implicit tracks and the parent's layout explodes into
  columns. Scope it: `.nur-stage > .nur-id { grid-area: id }`.

### Nursery v2 (wave 2 — N, 13.10) — `src/components/Nursery.tsx`, `nursery.css`, tabs in `PetsTab.tsx`

- Eggs (nests, basket, shop, `NestSheet`, `HatchScene`, `HatchBatch`) are untouched on the «Яйца»
  tab; on the pets tab the egg blocks are hidden by CSS (`.ppn.is-pets > :not(...)`).
- Layouts (`Layout` in the component): `one` phone portrait — stage / squad / action bar
  `[▦ 18/18] [take/leave] [i]` (no strip since wave 3 — it cut cells at both edges); `land` phone
  landscape — stage | side 1fr/1fr (plate, squad with the stat grid beside the slots, actions); `tall` tablet portrait — stage on top, side below with squad +
  full collection grid; `wide` tablet landscape & desktop — stage | side with the full grid.
  On `one`/`land` the full collection is a **drawer** over the side column (`.nur-drawer`,
  `data-ui-layer`, escape stack, focus into the selected cell on keyboard/pad, back to the grid
  button on close). Details (lore, roles, copies → gold, skins, eggs) = a `Modal sheet` on
  every layout (the `i` button, «!» badge when a merge is possible).
- Stage: lit sandstone room (radial light pool, floor band), framed animation buttons in a
  vertical column on the right (6 × `Button size="sm" icon`, always framed, unowned = `off` and
  says «hatch first»), the name plate under the room (`.px-dark` ink plate: name in the rarity
  colour + power picture and number on the right; rarity pill, ★ gold, level; at most 3 chips —
  stat picture + whole percent, biggest first, ties in the fixed stat order — + «+N» that opens
  details (≥ 44 × 28); XP bar «into / need» or «Предел»). Pet size: `useBox` measures `.nur-room` (`contain: size`),
  `pedFor` = pedestal pixel from the room (not the pet), `fitPet` picks the biggest whole-dot
  frame that fits above the pedestal; offsets rounded to 1/dpr.
- **Fixed layout (owner: «чтобы картинка не дёргалась»)**: every row has a fixed height from
  the TYPE scale (`calc(var(--px-fs-sm) * 1.65)`, not from `--u` — u-based rows made the plate
  tall on desktop and shrank the pet 448 → 336), names shrink to fit instead of wrapping, chips
  are capped, absent things keep their box. Check: `{SCR}/jump.mjs` selects the pets with the
  fewest/most roles + an unhatched one and compares bounding boxes of stage, room, pet, plate,
  anims, squad, collection, actions — all identical on all 6 formats.
- Squad («Отряд» + hint «Идут с тобой в шахту», `nursery.squad/squadHint`; on `land` the hint is
  the title's `data-tip`): three BIG slots (34 u, 26 u on phone landscape) — filled = select,
  empty = dashed frame + plus (picker), locked = lock + what unlocks it. Under them (beside them
  on `land`, 2 × 3 column-flow) ALL SIX summed stats in a fixed grid, order loot sell dmg / token
  luck rate; a missing stat keeps its cell (dim picture, «—»). 3 columns; 6 only via
  `@container nur-squad (min-width: 36em)` (em = the label size); never 4/5; it never scrolls.
- **Stat pictures (wave 3 — N2)**: `paint.ts` `STAT_ART` — 12 × 12 images `st-loot` gem, `st-sell`
  coin, `st-dmg` pick, `st-token`, `st-luck` key, `st-rate` clock, `st-power` bolt (ink outline,
  own-colour ramp, light upper-left; `--pximg-st-*`), drawn by `.nur-st.nur-st--<stat>` at `--st`
  = 24 CSS px (36 at ui-scale ≥ 4) rounded to whole device px per art px (`useStatPx`). The 9×9
  `ICONS` masks stay for UI glyphs. Rows holding a picture use `--row-st` = max(label × 1.65,
  picture + 4 px). The «i» sheet is a table: picture, `nursery.stat.<stat>` noun, dotted leader,
  value with one decimal; the full sentence is the row's tip; the sheet bar says «25 ур. · Предел».
- **No wrong-pet frames on switch**: the stage (art + plate) keeps the pet it shows until the new
  strip's `HTMLImageElement.decode()` resolves (`decodeArt`, a module cache of decoded srcs;
  `petArtSrc(id, size, v, thumb)` from `PetArt.tsx` gives the exact URL `PetArt` will load); the
  squad and ±3 collection neighbours are decoded 250 ms after a switch. `.nur-pet` is keyed by the
  shown id → an 80 ms `steps(2)` pop (`translate` 1 u). Cells and squad slots are `memo`
  (`NurCell`, `SquadSlot`) with a stable `onPick(id)`; `Slot tip` / `useTip` accept a function, so
  the 18 tooltips are built only when shown. `PrisonCamp` re-renders every second (`useNow(1000)`):
  `PetsTab` and `Nursery` are `memo` (PetsTab's `say` is a `useCallback`), else each tick
  re-rendered the whole Nursery and the hidden egg blocks (CPU profile at 4×: React work in a
  3-switch window 497 → 144 ms).
- Narrow plate (360-px phones, the large text size): three chips + «+N» need ≈ 17.2 em of the
  label size, so both variants are rendered and `@container nur-roles` shows two chips + «+N+1»
  below that (19 em when a value has 3 digits, `is-big`). A long name never goes below the label
  size: it wraps to two lines of it inside the fixed name row («Panzerknacker-Waschbär»). The
  action bar's grid button drops its count under 16 em so «Оставить дома» stays on one line.
- Leaving home keeps the slot empty (no shift), taking fills the first empty slot: a
  component-local view with holes (`SquadView`); the store still gets the compact list in the same
  order (`prisonSquadSet` compacts), and a squad change from elsewhere resets the view.
- Legendary/mythic: `.pet__aura`/`.pet__rays` are hidden on the stage (soft vector glow, cost
  frames); the light pool's hard bands take the rarity colour instead (`.nur-show--r3…r5`).
- Type on the screen: name hero (Coco Title), body `--px-fs` (power, headings), label `--px-fs-sm`
  (chips, rarity, level, hint, bar); weight 700 (slot counters keep `-tiny`). Small framed buttons
  (anim column, drawer ✕) get a `::before` hit area 3 u around them (≥ 44 px).
- The camp window chrome is the kit for EVERY camp since wave 2 (C, `gx-px.css`; see
  `game-ui.md` → «Window chrome on the kit»); `nursery.css` only sizes the pets camp and fills
  its body (`.gx-camp:has(.nur) .pcamp-body`). The pets camp is full height and
  `--gx-mw: 480` on every format (`.gx-win .gx-win__box.gx-camp:has(.ppn)`), same on both tabs:
  C's default caps camps at 250 u high, which made the tablet-portrait pet 96 px.
- Primary action «take along / leave home» (`inspect`: X / pad Y); squad full → replaces the
  last. Strings: area `nursery` (7 languages) + L's `pets.<id>.name/lore`.
- Pitfalls: a drawer placed in a grid area resizes its `auto` track — make it absolutely
  positioned (`inset: 0`, z 5) inside the area; the `hidden` attribute loses to a CSS
  `display` — render conditionally; new files in `public/` are not served by a running Vite —
  restart it. The gold mark on the plate is a ★ badge, the word shows only where the plate is
  wider than 17 em (em of its own text, so the large text size drops it too).
- **Not checked on a real phone / Telegram webview / gamepad hardware** (stand: Playwright at
  390×844@3, 844×390@3, 820×1180@2, 1180×820@2, 1440×900, 1920×1080; keyboard by real key
  presses, gamepad by emitted actions).

### Rollout — waves (owner 13.10: «когда волна закончилась, сразу запускай следующую»)

The lead launches the next wave as soon as the previous one is shipped — no question to the
owner. Each agent ships as its own version after the lead reviews its shots (6 formats, ru/de/tr).

- **Wave 1 (v2.143, done):** kit, fonts, shell + input, Nursery pilot.
- **Wave 2:** C — window chrome (`gx.tsx`: GxModal, GxSheet, GameTop, GxBar on the kit; the camp
  frame and tab bar in `PrisonCamp`); M — the mine screen (`PrisonPage` HUD, dock, sheets,
  `MineField` overlays, `MinePets`); F — forge, backpack, books (`ForgeScreen`, `Inventory`,
  `BooksTab`); K — casino (`GamesPage`, `SlotsPage`, `ScatterPage`, `SessionCard`, `SkinSheet`,
  `CashDesk`).
- **Wave 3:** camp tabs (`ChestTab`, shop, runes, finds, miles, perks, gear); yard + square
  (`YardPage`, `YardBits`, `Critters`, per-language sign images via `scripts/hub`); dungeon
  (`DungeonPage`, `DungeonCamp`, `DungeonInventory`, `DungeonRun` HUD, `DungeonMine`,
  `CreativePanel`).
- **Wave 4:** store-readiness pass (one hand, no page scroll, rotation/resize, full keyboard and
  gamepad traversal, one look for all windows); forest + fishing (flags off); dead old CSS out of
  `game-ui.css`.

Wave rules: new CSS in the screen's own file (like `nursery.css`), `game-ui.css` only loses the
screen's old blocks; no logic changes in `src/lib`; every new string through `t()` in 7 languages.

**Critic gate (owner 13.10: «агент критик… возвращать правки для других агентов»).** The `critic`
agent (`.claude/agents/critic.md`, checklist `.claude/critic/checklist.md`) reviews before
anything ships. It looks at every UI agent's AFTER shots and at every batch of owner screenshots.
It returns prioritised, measured fixes per agent and does not touch code. The lead relays the
fixes to the agent (SendMessage while its cache is alive, else a new agent with the fix list).
A screen ships only when the critic's P0 list is empty. Until a session reloads the agent
types, run it as `general-purpose` whose first step is to read `critic.md` as its role.

### Owner's verdicts on the v1 look (13.10, iPhone screenshots) — binding for every screen

- The pixel fonts (Tiny5, Press Start 2P) are «непонятный, сложно читаемый» → readable text font;
  he set the text size to «large» and «стало гораздо лучше» → today's «large» is the new default.
- Dark stone/obsidian palette: «на её фоне не особо всё хорошо видно» → lighter, warmer
  materials, measured text contrast (≥ 4.5:1), bright stage behind showcased art.
- The showcased thing is BIG: a pet «почти на весь экран, хотя бы на половину».
- **Nothing jumps:** «должно быть фиксированное, чтобы картинка не дёргалась» — selecting another
  pet/item or changing numbers never changes the size or position of panels, art or buttons
  (fixed rows, scroll inside, tabular numbers). Check by comparing bounding boxes in a script.
- **Things are bigger than the text about them:** three squad pets smaller than their bonus text
  = «ужасно». Owned/equipped things (slots, icons) dominate; bonuses are a secondary line.
- Every block must be obvious to a new player («„С собой“ непонятная»): a short title that says
  what it is and what to do, empty slots that look tappable, locks that say what unlocks them.
