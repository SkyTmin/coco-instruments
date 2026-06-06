import { describe, expect, it } from 'vitest';
import { cropToSource, FULL_CROP, resizeCrop, type DisplayRect } from './crop';

const rect: DisplayRect = { x: 0, y: 0, w: 100, h: 100 }; // min frac = 0.44

describe('crop geometry', () => {
  it('moves within the image bounds', () => {
    const r0 = { fx: 0.2, fy: 0.2, fw: 0.5, fh: 0.5 };
    const moved = resizeCrop('move', r0, 0.1, 0.1, rect);
    expect(moved.fx).toBeCloseTo(0.3, 10);
    expect(moved.fy).toBeCloseTo(0.3, 10);
    expect(moved.fw).toBe(0.5);
    expect(moved.fh).toBe(0.5);
    // can't push past the right/bottom edge (fx max = 1 - fw = 0.5)
    expect(resizeCrop('move', r0, 0.9, 0, rect).fx).toBeCloseTo(0.5, 10);
    expect(resizeCrop('move', r0, -0.9, 0, rect).fx).toBe(0);
  });

  it('a full-frame crop cannot move', () => {
    expect(resizeCrop('move', FULL_CROP, 0.3, 0.3, rect)).toEqual(FULL_CROP);
  });

  it('resizes from a corner, clamped to image + min size', () => {
    const r0 = { fx: 0.2, fy: 0.2, fw: 0.5, fh: 0.5 };
    const se = resizeCrop('se', r0, 0.2, 0.1, rect);
    expect(se.fw).toBeCloseTo(0.7, 10);
    expect(se.fh).toBeCloseTo(0.6, 10);
    // can't exceed the image: fw max = 1 - fx = 0.8
    expect(resizeCrop('se', r0, 0.9, 0, rect).fw).toBeCloseTo(0.8, 10);
    // nw shrink hits the min width (0.44), anchoring the right edge at 0.7
    const nw = resizeCrop('nw', r0, 0.2, 0.2, rect);
    expect(nw.fw).toBeCloseTo(0.44, 10);
    expect(nw.fx + nw.fw).toBeCloseTo(0.7, 10);
    expect(nw.fx).toBeGreaterThanOrEqual(0);
  });

  it('never produces out-of-range fractions', () => {
    const r0 = { fx: 0.1, fy: 0.1, fw: 0.6, fh: 0.6 };
    for (const m of ['nw', 'ne', 'sw', 'se', 'move'] as const) {
      for (const d of [-2, -0.3, 0.3, 2]) {
        const r = resizeCrop(m, r0, d, -d, rect);
        expect(r.fx).toBeGreaterThanOrEqual(-1e-9);
        expect(r.fy).toBeGreaterThanOrEqual(-1e-9);
        expect(r.fx + r.fw).toBeLessThanOrEqual(1 + 1e-9);
        expect(r.fy + r.fh).toBeLessThanOrEqual(1 + 1e-9);
        expect(r.fw).toBeGreaterThan(0);
        expect(r.fh).toBeGreaterThan(0);
      }
    }
  });

  it('maps crop fractions to source pixels', () => {
    expect(cropToSource({ fx: 0.25, fy: 0.5, fw: 0.5, fh: 0.25 }, 800, 600)).toEqual({
      sx: 200,
      sy: 300,
      sw: 400,
      sh: 150,
    });
  });
});
