/**
 * One calm, unified tag style across the whole app (graph nodes, chips, the
 * markdown renderer, note rows, filters). No per-tag random hues — tags use the
 * single design-system accent, so they read quietly and never visually shout.
 *
 * The function shape is kept so existing call sites don't change; every tag now
 * returns the same accent-derived, theme-aware colours.
 */

export interface TagColor {
  hue: number;
  depth: number;
  /** vivid colour for strokes, labels and chip text */
  stroke: string;
  /** translucent fill for graph node circles */
  fill: string;
  /** soft coloured glow */
  glow: string;
  /** faint background tint for chips */
  chipBg: string;
}

/** 0 for a top-level tag, 1 for `a/b`, 2 for `a/b/c`, … */
export function tagDepth(tag: string): number {
  return Math.max(0, tag.split('/').filter(Boolean).length - 1);
}

export function tagColor(tag: string): TagColor {
  return {
    hue: 0,
    depth: tagDepth(tag),
    stroke: 'var(--tag-fg)',
    fill: 'var(--tag-fill)',
    glow: 'var(--tag-glow)',
    chipBg: 'var(--tag-bg)',
  };
}
