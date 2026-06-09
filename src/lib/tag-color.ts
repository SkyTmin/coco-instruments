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
  // Children get lighter + slightly softer, so the topic stays the visual hub.
  const light = Math.min(72, 56 + depth * 9);
  const sat = Math.max(52, 70 - depth * 6);
  return {
    hue,
    depth,
    stroke: `hsl(${hue}, ${sat}%, ${light}%)`,
    fill: `hsla(${hue}, ${sat}%, ${light}%, 0.22)`,
    glow: `hsla(${hue}, ${Math.min(88, sat + 14)}%, ${Math.min(72, light + 6)}%, 0.55)`,
    chipBg: `hsla(${hue}, ${sat}%, ${light}%, 0.16)`,
  };
}
