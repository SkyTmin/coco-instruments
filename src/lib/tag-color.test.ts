import { describe, expect, it } from 'vitest';
import { tagColor, tagDepth } from './tag-color';

describe('tag colour', () => {
  it('measures hierarchy depth', () => {
    expect(tagDepth('здоровье')).toBe(0);
    expect(tagDepth('здоровье/горло')).toBe(1);
    expect(tagDepth('a/b/c')).toBe(2);
  });

  it('is deterministic and shares one hue across a namespace', () => {
    const parent = tagColor('здоровье');
    const child = tagColor('здоровье/горло');
    const grand = tagColor('здоровье/горло/боль');
    expect(parent.hue).toBe(child.hue);
    expect(child.hue).toBe(grand.hue);
    expect(tagColor('здоровье')).toEqual(parent); // stable
  });

  it('gives different topics different hues', () => {
    expect(tagColor('здоровье').hue).not.toBe(tagColor('работа').hue);
  });

  it('lightens nested tags so children read as lighter than their parent', () => {
    expect(tagColor('здоровье/горло').depth).toBe(1);
    const lightness = (s: string) => Number(s.match(/(\d+)%\)$/)![1]);
    expect(lightness(tagColor('здоровье/горло').stroke)).toBeGreaterThan(
      lightness(tagColor('здоровье').stroke),
    );
  });
});
