---
paths:
  - 'src/ui-px/**'
  - 'scripts/ui-px/**'
  - 'public/ui/kit/**'
  - 'src/components/Nursery.tsx'
  - 'src/components/nursery.css'
---

## Pixel UI kit — style guide (v1, 12.10.2026) — `src/ui-px/`, `scripts/ui-px/`

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
- Defaults use `:where()` (zero specificity) so variant classes win regardless of order.
- New piece: add to `PIECES` with its declared slice, bake, run `npx vitest run src/ui-px`
  (`paint.test.ts`: slice = measured, deterministic, icons 9×9 white, no half-alpha, unique names).

### Materials (5-tone ramps, dark → light; INK `#120a0e` outline everywhere)

| material                 | ramp                                      | use                                   |
| ------------------------ | ----------------------------------------- | ------------------------------------- |
| stone                    | `#23242d #343643 #4a4d5d #64687b #8a8fa2` | stages, showcase, mine screens        |
| iron                     | `#1a1e25 #2a3039 #404853 #5e6875 #8e99a7` | secondary buttons, tools, forge       |
| wood (dark)              | `#25140c #391f12 #53301b #724527 #986135` | windows, sheets, the camp frame       |
| parchment                | `#73502c #a27b4b #caa56e #e3c893 #f5e5bb` | readable text blocks, books           |
| obsidian                 | `#0a0810 #14101c #201a2b #32283f #54466e` | inspect/details, tooltips             |
| gold / red / green / ash | see `MAT`                                 | primary / danger / confirm / disabled |

Light comes from the UPPER LEFT: bevel highlight on top+left, shadow on bottom+right, buttons are
3 px deeper at the bottom (pressed = the face moves down 2 px, bottom lip gone).

### Rarity

Slot frames `slot-r0…r6` and name colours come from `lib/rarity.ts` (`RARITIES[i].color`) — never
only text. Locked/unknown = silhouette in the same cell (`PetArt ghost`, grey on dark slots,
black on the stage) + small lock bottom-right.

### Type

- Body: **Tiny5** (OFL, 8-px em) as `CocoPx`; headings and tiny digits: **Press Start 2P** renamed
  **«Coco Head»** (OFL with Reserved Font Name → renamed in the subset; licence files in
  `public/ui/fonts/`). Coverage: Latin + Latin-1/Extended-A (fr, tr, de, es, it) + Cyrillic; checked
  by `scripts/ui-px/fonts.py` (subset + coverage report). Fallbacks: GxRubik, system.
- Sizes are whole multiples of the 8-px em: `--ts = max(2, ui-scale − 1 + --ts-add)`;
  `--px-fs-tiny` 8·(ts−1), `--px-fs` 8·ts, `--px-fs-big` 8·(ts+1), `--px-fs-hero` 8·(ts+2).
  L's text-size setting (`html[data-text=s|l]`) shifts `--ts-add` by a whole step (fractional
  scales give uneven pixel rows). `font-synthesis: none` (no fake bold).
- Short labels; names in the rarity colour; numbers via `fmtNum`/`t()` params (locale).

### Spacing

Gaps 1/2/3/4/6 art px; panel padding = frame thickness (stone 6, wood 8, obsidian 5, parch 3);
slot 26 × 26 (`--slot`), small button min 15 × 15, button min 19 high.

### Components (`@/ui-px`)

`Panel` (material, `stage` = stone floor tile), `Button` (primary gold / secondary iron / danger
red / confirm green; `size="sm"`, `icon`, `on` toggle, `off` = aria-disabled but tappable to
explain, `hint` = key prompt), `Tabs` (tabPrev/tabNext = Shift+Tab/Tab, LB/RB; shoulder prompts on
gamepad), `Slot` (rarity frame, `selected`, `locked`, `empty`, `count`, `corner`, `dot`, `tip`),
`Grid` (equal cells, auto-fill), `Bar`, `Badge`, `Heading` (`ribbon`), `Icon`, `KeyHint` (S's
`<Prompt>` in a pixel keycap), `Tooltip`/`useTip` (mouse hover 300 ms, long press 450 ms on touch),
`Inspect`/`InspectRow`, `Modal` (portal, `data-ui-layer`, escape stack, `sheet` = docked bottom on
phones). Gallery for the stand only (not built): `http://127.0.0.1:<port>/scripts/ui-px/gallery.html`
(`?kbd=1`, `?pad=1`, `?modal=1&sheet`).

### States (buttons, slots, tabs)

normal → hover (mouse only, `@media (hover:hover) and (pointer:fine)`: one ramp step lighter) →
pressed (`:active`/`.is-down`: face 2 px down) → **focus: very visible** — a 2-px gold double ring
OUTSIDE the element (`.px-f::after`, `--pxk-focus`), shown for `:focus-visible` and S's
`[data-focus]` (gamepad), louder than hover and than `selected` (white ring with gold corners) →
disabled (`aria-disabled`: ash material, still clickable to show why).

### Input and formats

- Focusable things carry `px-f`; the shell moves focus spatially (arrows/D-pad); first focus →
  `data-autofocus`. A list where focus = selection (Nursery grid) selects on `onFocus`.
- Hotkeys via `useAction(…, { scope })` so they die when a window covers the screen; show them
  with `hint`/`KeyHint` (nothing on touch).
- Layout by S's format: `useFormFactor()` → `ff`, `landscape`, `scale`. Phone portrait: one
  column, selected thing on top, list scrolls, actions in the thumb zone. Phone landscape /
  tablet landscape / desktop: list | showcase | details. Tablet portrait: showcase | details on
  top, wide list below (more columns). Each column scrolls on its own; the page never scrolls.

### Nursery pilot (v1) — `src/components/Nursery.tsx`, `nursery.css`, tabs in `PetsTab.tsx`

- Replaces the old main view, `PetSheet` and `SquadPicker` (deleted). Eggs (nests, basket, hatch
  all, shop, `NestSheet`, `HatchScene`, `HatchBatch`) are untouched and live on the «Яйца» tab;
  a ready nest opens the screen on that tab. On the pets tab the egg blocks are hidden by CSS
  (`.ppn.is-pets > :not(...)`), not by JSX — less conflict with the eggs code.
- Showcase: stone stage + pedestal, big `PetArt` (64/52/72/88 art px by format), six animation
  buttons (loops idle/walk/sleep switch `anim`, one-shots happy/work/attack via `play`), tap =
  pat (+XP every 10 min, as before), name in rarity colour, rarity, gold badge, level bar, perks
  with values, power (`petScore × 10`).
- Squad bar (3 slots: filled = select, empty = picker modal, locked = rank J / prestige), squad
  totals in the header; collection: count, zoo bonus, sort (rarity/level/power) and filter
  (all/owned/missing) cycle buttons, grid of `Slot`s (level, ★ gold, «!» can merge, paw = along,
  hover/long-press tooltip). Details (column or sheet on phones): lore, roles with values, XP
  numbers, copies to gold + «make gold», skin choice for gold pets, eggs it hatches from.
- Primary action «take along / leave home» (`inspect`: X / pad Y). Squad full → replaces the last
  (as before). Strings: area `nursery` (7 languages) + L's `pets.<id>.name/lore`.
- The camp sheet chrome (GxSheet in `PrisonCamp`, not ours) is restyled only around the Nursery
  via `.gx-camp.is-single:has(.ppn)`: pixel wood frame, kit ribbon, full height, wide on
  landscape/tablet/desktop, dark well body on the pets tab. Inside the multi-tab camps (forest,
  dungeon, fishing) the Nursery keeps the old chrome.
- **Not checked on a real phone / Telegram webview / gamepad hardware** (stand: Playwright at
  390×844@3, 844×390@3, 820×1180@2, 1180×820@2, 1440×900, 1920×1080; keyboard by real key
  presses, gamepad by emitted actions).
