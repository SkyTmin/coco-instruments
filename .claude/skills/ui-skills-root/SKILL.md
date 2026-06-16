---
name: ui-skills-root
description: Use before UI-related work to select the smallest useful UI Skills context. Routes a clear UI goal to the right craft/visual/layout skill below.
license: MIT
metadata:
  author: ibelick
  version: "1.0.0"
  source: https://github.com/ibelick/ui-skills
---

# UI Skills Root

You are the routing layer for UI Skills.

Use it when an agent (Claude Code, Codex, Cursor) has a clear UI goal in this
repo. If the goal is unclear, ask one short question. If the goal is clear,
choose the right skill, load the smallest useful context, then implement.

> Note for this repo: the upstream skill drives selection through the
> `npx ui-skills` CLI. Here the skills are vendored locally under
> `.claude/skills/`, so you do not need the CLI — read the relevant
> `SKILL.md` directly instead. See `.claude/skills/README.md` for how each
> rule maps onto Coco's plain-CSS + Telegram UI stack.

## Available skills

- `baseline-ui` — fast deslop/polish pass (spacing, hierarchy, typography, small layout).
- `fixing-accessibility` — ARIA, keyboard, focus, contrast, form errors (WCAG).
- `fixing-motion-performance` — animation jank, compositor props, scroll-linked motion, blur.
- `fixing-metadata` — titles, descriptions, canonical, Open Graph, favicons, JSON-LD.

## Protocol

1. decide if the task is UI-related
2. if not, return `no skill needed`
3. identify the likely category (craft, accessibility, motion, metadata)
4. read that skill's `SKILL.md`
5. select the smallest useful skill set
6. load only selected skill(s)
7. implement using that context

## Selection Rules

Prefer 1 skill.

Use 2 only when the task needs two clear angles.

Use 3 only for broad review, redesign, or multi-surface work.

Never use more than 3.

Route by topic, then stack, then specificity.

Prefer specific skills over broad skills.

For quick cleanup, prefer the most specific craft, visual, or layout skill available.

If unsure, pick the safest narrow skill.
