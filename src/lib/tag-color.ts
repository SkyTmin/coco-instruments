/**
 * Deterministic per-tag colours. The hue comes from the tag's *root* segment,
 * so an entire namespace (#здоровье, #здоровье/горло, #здоровье/нос) shares one
 * hue — and nested tags read as lighter "children" of their topic. Inspired by
 * Obsidian's "Colored Tags" plugin (nested colours derived from the root).
 *
 * Legacy comma HSL syntax is used on purpose for the widest WebView support.
 */

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

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
  const root = (tag.split('/').filter(Boolean)[0] ?? tag).toLocaleLowerCase('ru-RU');
  const depth = tagDepth(tag);
  const hue = hashString(root) % 360;
  // Milky, low-saturation tones (dusty rose, sage, slate — never neon): the
  // whole namespace shares a hue, children get lighter and softer than the
  // parent topic, so hierarchy reads like shades of one candy.
  const light = Math.min(68, 50 + depth * 8);
  const sat = Math.max(26, 38 - depth * 4);
  return {
    hue,
    depth,
    stroke: `hsl(${hue}, ${sat}%, ${light}%)`,
    fill: `hsla(${hue}, ${sat + 8}%, ${light + 8}%, 0.28)`,
    glow: `hsla(${hue}, ${sat + 10}%, ${light + 10}%, 0.3)`,
    chipBg: `hsla(${hue}, ${sat + 8}%, ${light}%, 0.14)`,
  };
}
