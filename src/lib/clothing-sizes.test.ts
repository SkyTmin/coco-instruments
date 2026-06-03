import { describe, expect, it } from 'vitest';
import { getSizeCategory, outerwearInt, shirtInt, SIZE_CATEGORIES } from './clothing-sizes';

const compute = (id: string, v: Record<string, number>, gender: 'male' | 'female' = 'male') =>
  getSizeCategory(id)!.compute(v, gender);

describe('outerwear', () => {
  it('RU = chest/2, US = RU-10, INT by chest', () => {
    expect(compute('outerwear', { chest: 100 })).toEqual([
      { label: 'RU / EU', value: '50' },
      { label: 'US', value: '40' },
      { label: 'INT', value: 'M' },
    ]);
  });
  it('classifies INT ranges', () => {
    expect(outerwearInt(90)).toBe('S');
    expect(outerwearInt(105)).toBe('L');
    expect(outerwearInt(130)).toBe('XXXL');
    expect(outerwearInt(80)).toBe('XS');
  });
});

describe('shirt', () => {
  it('size = round(chest/2), INT by half-chest, optional collar', () => {
    const r = compute('shirt', { chest: 104, neck: 40 });
    expect(r).toContainEqual({ label: 'Размер', value: '52' });
    expect(r).toContainEqual({ label: 'INT', value: 'L' });
    expect(r).toContainEqual({ label: 'Ворот', value: '41.5 см' });
  });
  it('omits collar when neck not given', () => {
    const r = compute('shirt', { chest: 100 });
    expect(r.some((x) => x.label === 'Ворот')).toBe(false);
  });
  it('shirtInt ranges', () => {
    expect(shirtInt(96)).toBe('S'); // half 48
    expect(shirtInt(104)).toBe('L'); // half 52
  });
});

describe('pants', () => {
  it('W/L in inches, with combined size', () => {
    const r = compute('pants', { waist: 81.28, inseam: 81.28 });
    expect(r).toContainEqual({ label: 'W (талия)', value: '32' });
    expect(r).toContainEqual({ label: 'L (длина)', value: '32' });
    expect(r).toContainEqual({ label: 'Размер', value: 'W32/L32' });
  });
  it('omits length when inseam missing', () => {
    expect(compute('pants', { waist: 81.28 })).toEqual([{ label: 'W (талия)', value: '32' }]);
  });
});

describe('shoes', () => {
  it('EU from foot length, US depends on gender', () => {
    expect(compute('shoes', { foot: 26 }, 'male')).toEqual([
      { label: 'RU / EU', value: '41' },
      { label: 'US', value: '8' },
      { label: 'UK', value: '7' },
    ]);
    const female = compute('shoes', { foot: 26 }, 'female');
    expect(female).toContainEqual({ label: 'US', value: '10' });
  });
});

describe('categories', () => {
  it('exposes four categories', () => {
    expect(SIZE_CATEGORIES.map((c) => c.id)).toEqual(['outerwear', 'shirt', 'pants', 'shoes']);
  });
});
