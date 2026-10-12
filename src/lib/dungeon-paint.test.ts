import { describe, expect, it } from 'vitest';
import { frameLRU, onFrameReset, resetFrameCaches } from './dungeon-paint';

describe('сброс кешей кадров при смене этажа', () => {
  it('чистит каждый frameLRU и зовёт свои сбросы', () => {
    const a = frameLRU<number>(10);
    const b = frameLRU<number>(10);
    a.set('x', 1);
    b.set('y', 2);
    const extra = new Map([['z', 3]]);
    onFrameReset(() => extra.clear());
    resetFrameCaches();
    expect(a.size).toBe(0);
    expect(b.size).toBe(0);
    expect(extra.size).toBe(0);
    // после сброса кеш работает как прежде
    a.set('x', 5);
    expect(a.get('x')).toBe(5);
  });
});
