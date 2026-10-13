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

## Baseline numbers (well-known; the critic re-verifies them and adds sources below)

- Touch targets: Apple HIG ≥ 44×44 pt; Material ≥ 48×48 dp, with ≥ 8 dp between targets.
- Contrast (WCAG 2.x): body text ≥ 4.5:1; large text (≥ 24 px, or ≥ 18.66 px bold) ≥ 3:1;
  icons and UI parts that carry meaning ≥ 3:1 (1.4.11).
- Pixel art scales by whole numbers only, is never rotated by a fraction, and keeps one ink
  stroke weight across a screen.
- At most 3 text sizes and 2 weights per screen. Numbers are tabular.
- A phone page never scrolls (lists may). Nothing goes past the safe area.

## Researched rules (critic appends here: `- <rule with number> — <source URL> (<date>)`)
