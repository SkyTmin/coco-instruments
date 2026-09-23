import { describe, expect, it } from 'vitest';
import { CREW_FED_BOOST, crewCapHours, crewYield, normalizePrison, PRISON_START } from './prison';
import type { PrisonState } from './prison';

const h = 3_600_000;
const crew = (patch: Partial<PrisonState> = {}): PrisonState =>
  normalizePrison({ ...PRISON_START, rank: 5, crew: 3, crewFrom: 1_000_000, ...patch });

describe('наряды бригады', () => {
  it('ударная — в 2,5 раза быстрее, но упирается в два часа', () => {
    const norm = crewYield(crew(), 1_000_000 + h);
    const rush = crewYield(crew({ crewShift: 'rush' }), 1_000_000 + h);
    expect(rush.blocks / norm.blocks).toBeCloseTo(2.5, 1);
    expect(crewCapHours(crew({ crewShift: 'rush' }))).toBe(2);
    expect(crewYield(crew({ crewShift: 'rush' }), 1_000_000 + 5 * h).capped).toBe(true);
  });

  it('разведка копает вполсилы шесть часов, норма — восемь', () => {
    expect(crewCapHours(crew({ crewShift: 'scout' }))).toBe(6);
    expect(crewCapHours(crew())).toBe(8);
    const norm = crewYield(crew(), 1_000_000 + h).blocks;
    const scout = crewYield(crew({ crewShift: 'scout' }), 1_000_000 + h).blocks;
    expect(scout / norm).toBeCloseTo(0.5, 1);
  });

  it('пайка даёт +30% ко всей смене', () => {
    const plain = crewYield(crew(), 1_000_000 + 2 * h).blocks;
    const fed = crewYield(crew({ crewFed: true }), 1_000_000 + 2 * h).blocks;
    expect(fed / plain).toBeCloseTo(1 + CREW_FED_BOOST, 1);
  });

  it('перк «Длинная смена» удлиняет любой наряд', () => {
    const perks = { ...PRISON_START.perks, shift: 4 };
    expect(crewCapHours(crew({ perks }))).toBe(12);
    expect(crewCapHours(crew({ perks, crewShift: 'rush' }))).toBe(3);
    expect(crewCapHours(crew({ perks, crewShift: 'scout' }))).toBe(8);
  });

  it('битый наряд в сохранении — норма', () => {
    expect(normalizePrison({ ...PRISON_START, crewShift: 'чифир' as never }).crewShift).toBe(
      'norm',
    );
  });
});
