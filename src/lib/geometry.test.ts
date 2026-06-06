import { describe, expect, it } from 'vitest';
import { SHAPES, getShape, shapesByCategory } from './geometry';

function result(id: string, key: string, vals: Record<string, number>): number {
  const shape = getShape(id)!;
  return shape.results.find((r) => r.key === key)!.compute(vals);
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe('geometry catalogue', () => {
  it('has unique ids and at least one result each', () => {
    const ids = SHAPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHAPES) {
      expect(s.vars.length).toBeGreaterThan(0);
      expect(s.results.length).toBeGreaterThan(0);
    }
    expect(shapesByCategory('2d').length).toBeGreaterThan(0);
    expect(shapesByCategory('3d').length).toBeGreaterThan(0);
  });

  it('computes 2D shapes correctly', () => {
    expect(result('square', 'A', { a: 4 })).toBe(16);
    expect(result('square', 'P', { a: 4 })).toBe(16);
    expect(result('rectangle', 'A', { a: 3, b: 5 })).toBe(15);
    expect(result('rectangle', 'd', { a: 3, b: 4 })).toBe(5);
    // 3-4-5 right triangle → area 6
    expect(close(result('triangle', 'A', { a: 3, b: 4, c: 5 }), 6)).toBe(true);
    expect(result('triangle', 'P', { a: 3, b: 4, c: 5 })).toBe(12);
    expect(close(result('equilateral', 'A', { a: 2 }), Math.sqrt(3))).toBe(true);
    expect(close(result('circle', 'A', { r: 1 }), Math.PI)).toBe(true);
    expect(result('rhombus', 'A', { d1: 6, d2: 8 })).toBe(24);
    expect(result('rhombus', 'a', { d1: 6, d2: 8 })).toBe(5);
    // regular hexagon, side 2 → area = 6·√3
    expect(close(result('polygon', 'A', { n: 6, s: 2 }), 6 * Math.sqrt(3))).toBe(true);
    expect(result('polygon', 'ang', { n: 6, s: 2 })).toBe(120);
    expect(result('annulus', 'A', { R: 5, r: 3 })).toBeCloseTo(Math.PI * 16, 9);
  });

  it('computes 3D shapes correctly', () => {
    expect(result('cube', 'V', { a: 3 })).toBe(27);
    expect(result('cube', 'A', { a: 3 })).toBe(54);
    expect(result('cuboid', 'V', { a: 2, b: 3, c: 4 })).toBe(24);
    expect(close(result('sphere', 'V', { r: 3 }), (4 / 3) * Math.PI * 27)).toBe(true);
    expect(close(result('sphere', 'A', { r: 3 }), 4 * Math.PI * 9)).toBe(true);
    expect(close(result('cylinder', 'V', { r: 2, h: 5 }), Math.PI * 4 * 5)).toBe(true);
    expect(close(result('cone', 'V', { r: 3, h: 4 }), (Math.PI * 9 * 4) / 3)).toBe(true);
    expect(result('cone', 'l', { r: 3, h: 4 })).toBe(5);
    expect(result('triangular-prism', 'V', { b: 3, h: 4, L: 10 })).toBe(60);
    expect(close(result('torus', 'V', { R: 5, r: 1 }), 2 * Math.PI ** 2 * 5)).toBe(true);
  });

  it('validation rejects impossible inputs', () => {
    expect(getShape('triangle')!.validate!({ a: 1, b: 1, c: 5 })).toBeTruthy();
    expect(getShape('triangle')!.validate!({ a: 3, b: 4, c: 5 })).toBeNull();
    expect(getShape('annulus')!.validate!({ R: 2, r: 5 })).toBeTruthy();
    expect(getShape('polygon')!.validate!({ n: 2, s: 1 })).toBeTruthy();
    expect(getShape('polygon')!.validate!({ n: 5, s: 1 })).toBeNull();
  });
});
