# UI Skills (vendored)

Design-engineering **skills** for agents (Claude Code, Cursor, Codex), vendored
into this repo so they're available offline and checked in for everyone.

- **Source:** [`ibelick/ui-skills`](https://github.com/ibelick/ui-skills) ·
  catalog at [ui-skills.com](https://www.ui-skills.com/)
- **License:** MIT (© ibelick). Each `SKILL.md` keeps its upstream `license` /
  `metadata.source`.

These are **guidance/review skills**, not app code. They are NOT imported by the
bundle and do NOT affect the deployed Mini App — so they don't need a `prod`
deploy or an `APP_VERSION` bump. They only steer how agents write/review UI.

## What's here

| skill | use it for |
|-------|------------|
| [`ui-skills-root`](./ui-skills-root/SKILL.md) | router — pick the smallest useful skill before UI work |
| [`baseline-ui`](./baseline-ui/SKILL.md) | fast "deslop"/polish pass: spacing, hierarchy, typography, small layout |
| [`fixing-accessibility`](./fixing-accessibility/SKILL.md) | ARIA names, keyboard, focus/dialogs, contrast, form errors (WCAG) |
| [`fixing-motion-performance`](./fixing-motion-performance/SKILL.md) | animation jank: compositor props, layout thrash, scroll-linked motion, blur |
| [`fixing-metadata`](./fixing-metadata/SKILL.md) | titles, descriptions, canonical, Open Graph, favicons, JSON-LD |

## How to use

Ask the agent to run a skill against a file, e.g.:

- "Прогони `baseline-ui` по `src/pages/HomePage.tsx`"
- "Проверь `src/components/ChatThread.tsx` скиллом `fixing-accessibility`"
- "Отрефактори анимацию графа по `fixing-motion-performance`"

The agent reads the relevant `SKILL.md`, reports violations (quoted snippet →
why → concrete fix), and applies minimal targeted changes.

## Reading them in Coco's stack (important)

The upstream `baseline-ui` skill assumes **Tailwind CSS + `motion/react` +
`cn`**. This project does **not** use those — it's **plain CSS (`src/theme.css`)
+ `@telegram-apps/telegram-ui`**, with `@tma.js/sdk-react` for the Mini App.
Apply the *intent* of each rule, mapped to our primitives:

| upstream rule | Coco equivalent |
|---------------|-----------------|
| Tailwind utility classes / tokens | CSS classes in `src/theme.css`; reuse existing `--bg-1`, `--bg-2`, accent vars before adding new ones |
| `cn` / `clsx` + `tailwind-merge` | plain `className` strings / template literals |
| `motion/react` for JS animation | CSS transitions/keyframes on `transform`/`opacity`; rAF only where already used (e.g. graph sim) |
| `tw-animate-css` entrances | existing CSS keyframes in `theme.css` |
| `h-dvh`, never `h-screen` | already done — we use `100dvh` / `--chat-vh` |
| respect `safe-area-inset` | use `--safe-top`, `--safe-bottom`, `--content-top` (already defined) |
| feedback ≤ 200ms; haptics | CSS ≤ 200ms; haptics via `src/lib/haptics.ts` |
| fixed `z-index` scale | we have ad-hoc z-index values — prefer reusing existing layers, don't invent arbitrary ones |
| accessible primitives (Radix/Base UI) | prefer `@telegram-apps/telegram-ui` components first |
| `prefers-reduced-motion` | already honored across `theme.css` — keep new motion behind it |

`fixing-accessibility`, `fixing-motion-performance`, and `fixing-metadata` are
mostly stack-agnostic and apply directly.

## Updating

These are a point-in-time copy. To refresh from upstream:

```bash
# inspect upstream
curl -s https://raw.githubusercontent.com/ibelick/ui-skills/main/skills/<slug>/SKILL.md
# or browse https://www.ui-skills.com/skills/
```

Re-paste changed `SKILL.md` bodies here (keep the `metadata.source` line).
