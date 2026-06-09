import { describe, expect, it } from 'vitest';
import { tagColor, tagDepth } from './tag-color';

describe('tag colour', () => {
  it('measures hierarchy depth', () => {
    expect(tagDepth('здоровье')).toBe(0);
    expect(tagDepth('здоровье/горло')).toBe(1);
    expect(tagDepth('a/b/c')).toBe(2);
  });

  it('is one unified style for every tag (no random per-tag colours)', () => {
    const a = tagColor('здоровье');
    const b = tagColor('работа');
    expect(a.stroke).toBe(b.stroke);
    expect(a.fill).toBe(b.fill);
    expect(a.chipBg).toBe(b.chipBg);
    // and it leans on a single design-system token rather than a hashed hue
    expect(a.stroke).toContain('--tag');
  });
});
