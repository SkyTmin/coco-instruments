// Этаж 15 «Ядро подземелья», половина «Мир» (пишется).
import { describe, expect, it } from 'vitest';
import { FLOORS } from './index';

describe('этаж 15', () => {
  it('собран', () => {
    expect(FLOORS.find((f) => f.id === 15)?.mapVer).toBe(3);
  });
});
