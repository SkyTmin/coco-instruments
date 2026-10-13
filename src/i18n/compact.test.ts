import { describe, expect, it } from 'vitest';
import { fmtCompact } from './core';

// HUD chips (GameTop, the mine's top bar) — one compact formatter for the shared wallet.
const NB = ' ';

describe('fmtCompact', () => {
  it('keeps small numbers whole, with the language grouping', () => {
    expect(fmtCompact(12, 'ru')).toBe('12');
    expect(fmtCompact(9999, 'ru')).toBe(`9${NB}999`);
    expect(fmtCompact(9999, 'de')).toBe('9.999');
    expect(fmtCompact(9999, 'en')).toBe('9,999');
  });

  it('shortens from 10 000 in the language’s own words', () => {
    expect(fmtCompact(510_812_345, 'ru')).toBe(`511${NB}млн`);
    expect(fmtCompact(9_769_119, 'ru')).toBe(`9,8${NB}млн`);
    expect(fmtCompact(12_345, 'ru')).toBe(`12${NB}тыс.`);
    expect(fmtCompact(510_812_345, 'de')).toBe(`511${NB}Mio.`);
    expect(fmtCompact(9_769_119, 'de')).toBe(`9,8${NB}Mio.`);
    expect(fmtCompact(510_812_345, 'tr')).toBe(`511${NB}Mn`);
    expect(fmtCompact(9_769_119, 'tr')).toBe(`9,8${NB}Mn`);
    expect(fmtCompact(510_812_345, 'en')).toBe('511M');
    expect(fmtCompact(9_769_119, 'en')).toBe('9.8M');
  });

  it('never prints the narrow no-break space the game font can’t show', () => {
    for (const l of ['ru', 'fr', 'de', 'tr', 'en', 'es', 'it'] as const)
      expect(fmtCompact(510_812_345, l)).not.toMatch(/ /);
    expect(fmtCompact(Number.NaN, 'ru')).toBe('—');
  });
});
