import { describe, expect, it } from 'vitest';
import {
  CRACK_KINDS,
  CRACK_N,
  CRACK_STAGES,
  crackMap,
  crackStageOf,
  crackStagePixels,
  stageLimit,
} from './crack-stages';

describe('разлом как в Майнкрафте', () => {
  it('сколько ударов, столько кадров: каждый удар до разлома даёт новую стадию', () => {
    for (let hits = 1; hits <= CRACK_STAGES; hits++) {
      const max = 7.3 * hits; // запас не делится ровно — как у настоящей руды
      const dmg = max / hits;
      const seen: number[] = [];
      for (let k = 1; k < hits; k++) seen.push(crackStageOf(max - dmg * k, max));
      // Все стадии разные и растут.
      for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
      for (const s of seen) {
        expect(s).toBeGreaterThanOrEqual(1);
        expect(s).toBeLessThanOrEqual(CRACK_STAGES);
      }
    }
    // Два удара — половина сети, три — треть и две трети.
    expect(crackStageOf(5, 10)).toBe(6);
    expect([crackStageOf(6, 9), crackStageOf(3, 9)]).toEqual([4, 7]);
  });

  it('целый блок без трещины, почти разбитый — последняя стадия', () => {
    expect(crackStageOf(10, 10)).toBe(0);
    expect(crackStageOf(0.001, 10)).toBe(CRACK_STAGES);
  });

  it('трещина растёт, а не подменяется: каждая стадия содержит прошлую', () => {
    for (let v = 0; v < CRACK_KINDS; v++) {
      const { t, max } = crackMap(v);
      for (let k = 1; k < CRACK_STAGES; k++) {
        const a = stageLimit(k - 1, max);
        const b = stageLimit(k, max);
        expect(b).toBeGreaterThan(a);
        let prev = 0;
        let cur = 0;
        for (const x of t) {
          if (x <= a) prev++;
          if (x <= b) cur++;
        }
        expect(cur).toBeGreaterThan(prev);
      }
    }
  });

  it('первая стадия — пара пикселей, последняя — сеть через весь блок', () => {
    for (let v = 0; v < CRACK_KINDS; v++) {
      const ink = (k: number) => {
        const px = crackStagePixels(v, k);
        let dark = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200) dark++;
        return dark / (CRACK_N * CRACK_N);
      };
      expect(ink(0)).toBeLessThan(0.02);
      expect(ink(CRACK_STAGES - 1)).toBeGreaterThan(0.08);
      expect(ink(CRACK_STAGES - 1)).toBeLessThan(0.45);
    }
  });
});
