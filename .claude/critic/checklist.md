# UI critic — checklist and researched rules

Read by the `critic` agent (`.claude/agents/critic.md`) before every review. Not auto-loaded.
The critic appends researched rules at the bottom: one line each, with a number, a source and a date.

## Owner's verdicts (binding; full text in `.claude/rules/ui-px.md`)

- Text is readable on a phone at arm's length. The kit default is ≈ 20 CSS px; nothing a
  player must read is smaller than ≈ 16 px.
- Light palette with high contrast. Dark surfaces carry `.px-dark` (cream text).
- The main thing is BIG. A showcase takes at least half the screen.
- NOTHING JUMPS. Changing the selection or a number never moves or resizes a panel.
- Owned things (pets, items, icons) are bigger than the text about them.
- Every block is obvious to a new player: a short title that says what it is and what to do.
- No walls of text. Use an icon, a number and a short noun; details go in a tooltip or an
  inspect panel.

## Owner complaints to re-check on every screen (13.10.2026)

- Perk and bonus icons are too thick (heavy stroke) and too small next to their text.
- Pet and bonus info «looks like a lot of text». Bonus lines wrap, and names wrap.
- Square, phone portrait: the top HUD chips (money, tokens, rank) run past the right edge.
- Square, phone landscape: the camera is too close; the hero and their surroundings fill the view.
- Owner (13.10): the critic also tests animations, button presses, smoothness and speed.

## Baseline numbers (well-known; the critic re-verifies them and adds sources below)

- Touch targets: Apple HIG ≥ 44×44 pt; Material ≥ 48×48 dp, with ≥ 8 dp between targets.
- Contrast (WCAG 2.x): body text ≥ 4.5:1; large text (≥ 24 px, or ≥ 18.66 px bold) ≥ 3:1;
  icons and UI parts that carry meaning ≥ 3:1 (1.4.11).
- Pixel art scales by whole numbers only, is never rotated by a fraction, and keeps one ink
  stroke weight across a screen.
- At most 3 text sizes and 2 weights per screen. Numbers are tabular.
- A phone page never scrolls (lists may). Nothing goes past the safe area.
- Response limits (Nielsen): within 0.1 s feels instant, so press feedback comes within 1–2
  frames; by 1 s the flow of thought breaks; after 10 s attention is lost.
- Motion: 60 fps means 16.7 ms per frame. Animate only `transform` and `opacity`. UI
  transitions are short and consistent (the critic verifies the exact ranges in Material and
  Apple motion guidance). Pixel art moves by whole art pixels.

## Researched rules (critic appends here: `- <rule with number> — <source URL> (<date>)`)
- R1 Stat/role icons next to text: icon height ≈ 2× the label's cap height, and the icon's stroke weight matches the text weight (bold digits next to a hairline or a blob both fail). Phone: 24 CSS px icon next to 17 px digits — https://developer.apple.com/design/human-interface-guidelines/sf-symbols (13.10.2026)
- R2 Icon stroke ≈ 8 % of the icon size (Material system icons: 2 dp stroke on a 24 dp grid, 20 dp live area). Our 9×9 masks with 2-art-px strokes are 22 % → read as blobs; a 12×12 pixel icon with a 1-art-px outline is ≈ 8 % — https://material.io/design/iconography/system-icons.html (13.10.2026)
- R3 Show at most 3 bonus lines per item/pet at first glance; Diablo IV S4 cut item affixes to 3 (2 on lower rarities) with simpler wording so items read at a glance. Extra bonuses → «+N» chip, details in the inspect sheet — https://news.blizzard.com/diablo4/24077223/ (13.10.2026)
- R4 Stat sheet: main stat biggest, each sub-stat one short line «icon · noun · value», no sentences in the list (Genshin artifact layout); the explanation goes to the tooltip — https://keqingmains.com/misc/artifacts/ (13.10.2026)
- R5 Active bonuses = a row of icons with a short number/duration; the name and the description live in the icon's tooltip (Terraria buff bar). Never a horizontally scrolling text row — https://terraria.wiki.gg/wiki/Buffs (13.10.2026)
- R6 Use simple, clear language and don't carry information by text alone (pair it with icons/colour) — https://gameaccessibilityguidelines.com/use-simple-clear-language/ (13.10.2026)
- R7 Pixel camera zoom is a whole number taken from BOTH axes: `zoom = max(1, min(floor(H/refH), floor(W/refW)))` (Unity Pixel Perfect Camera). Ours: ref 192×176 art px → ≥ 12 tiles across and ≥ 11 down; hero ≈ 7.7–8.3 % of the short side in every format — https://github.com/Unity-Technologies/Graphics/blob/master/Packages/com.unity.render-pipelines.universal/Runtime/2D/PixelPerfectCameraInternal.cs (13.10.2026)
- R8 Render the pixel world at 1 art px = 1 px into a small buffer and upscale once («Upscale Render Texture»): sprites land on whole art px (no mixels/shimmer) and fill cost drops by scale². 320×180 ×6 = 1080p is the common base — https://docs.unity3d.com/Packages/com.unity.2d.pixel-perfect@4.0/manual/index.html , https://bugnet.io/blog/choosing-a-pixel-art-resolution-for-your-game (13.10.2026)
- R9 HUD numbers ≥ 10 000 use `Intl.NumberFormat(lang, {notation:'compact'})` (ru «511 млн», de «511 Mio.», tr «511 Mn», en «511M»), one formatter for every wallet chip, tabular digits + a min-width so neighbours don't move; the exact value goes to a tip/popover — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat (13.10.2026)
- R10 Every top bar must fit 360 CSS px (360×800 is the #2 mobile screen worldwide, ≈ 9 %): check `scrollWidth ≤ clientWidth` at 360/390/440 in ru/de/tr; collapse in order title → secondary buttons into one ⚙ → low-priority chips; money never hides — https://gs.statcounter.com/screen-resolution-stats/mobile/worldwide (13.10.2026)
- R11 Press feedback shows in the first frame after `pointerdown` (set `.is-down` in JS). Measured on our stand (touch, 4× CPU): `:active` appeared only 80–90 ms AFTER pointerup, never during a 400 ms hold; `.px-slot` has no pressed style at all — measured, critic1 Nursery/square review (13.10.2026)
- R12 Minimum text BODY height (lowest descender → highest ascender), XAG 101: PC 1080p 18 px, console 1080p 26 px, mobile 400 DPI 72 device px (≈ 24 CSS px at DPR 3). Our Rubik 700: 17 px font → 15 px body, 20 px → 19 px body (canvas measureText, mine review) — https://devdocs.xbox.com/build/game-principles/accessibility/xag-deep-dives/xag-101-text-display.md (13.10.2026)
- R13 Touch target ≥ 48×48 dp (Android); if the art must stay smaller, add an invisible hit area (`::before` with negative inset — `::after` is the kit focus ring) — https://developer.android.com/guide/topics/ui/accessibility/apps (13.10.2026)
- R14 Focus must stay visible (WCAG 2.4.7). The kit ring `.px-f::after` sits 3u OUTSIDE the box, so `overflow: hidden` on any `.px-f` element clips its own ring: test = focus each `.px-f`, `scrollWidth > clientWidth` on it means a clipped ring. Never reuse `.px-f::after` for decoration (it inherits `opacity: 0`) — use `::before` or a child — https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html (13.10.2026)
- R15 Tap → first visible response ≤ 100 ms («0.1 s feels instant»). Measure the first rAF delta after the tap on a 4× CPU-throttled context; a 120–160 ms `steps()` window intro is useless if the mount frame takes 250–370 ms — https://www.nngroup.com/articles/response-times-3-important-limits/ (13.10.2026)
- R16 A state shown by colour (bag full = red) needs a second cue — a number past capacity, a shape or a «!» badge (WCAG 1.4.1) — https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html (13.10.2026)
