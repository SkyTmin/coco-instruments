import { describe, expect, it } from 'vitest';
import { DAY_MS, dayPart, dayPhase, lampsOn, nightness, shadeAt } from './hub-time';

describe('сутки площади', () => {
  it('двадцать минут, одни на всех: час зависит только от времени', () => {
    expect(dayPhase(0)).toBe(0);
    expect(dayPhase(DAY_MS / 2)).toBeCloseTo(0.5, 9);
    expect(dayPhase(DAY_MS * 7 + 60_000)).toBeCloseTo(0.05, 9);
    expect(dayPhase(-60_000)).toBeCloseTo(0.95, 9);
  });

  it('доли суток: день 50%, закат 7,5%, ночь 35%, рассвет 7,5%', () => {
    const n = 100_000;
    const got = { dawn: 0, day: 0, dusk: 0, night: 0 };
    for (let i = 0; i < n; i++) got[dayPart((i + 0.5) / n)]++;
    expect(got.day / n).toBeCloseTo(0.5, 3);
    expect(got.dusk / n).toBeCloseTo(0.075, 3);
    expect(got.night / n).toBeCloseTo(0.35, 3);
    expect(got.dawn / n).toBeCloseTo(0.075, 3);
  });

  it('темнота непрерывна, в том числе на стыке суток', () => {
    const n = 20_000;
    let prev = shadeAt(0);
    let da = 0;
    let dc = 0;
    for (let i = 1; i <= n; i++) {
      const s = shadeAt(i / n);
      da = Math.max(da, Math.abs(s.a - prev.a));
      dc = Math.max(dc, Math.abs(s.r - prev.r), Math.abs(s.g - prev.g), Math.abs(s.b - prev.b));
      prev = s;
    }
    // За 1/20000 суток (60 мс) ничего не прыгает.
    expect(da).toBeLessThan(0.01);
    expect(dc).toBeLessThan(2);
    const a = shadeAt(1 - 1e-9);
    const b = shadeAt(0);
    expect(a.a).toBeCloseTo(b.a, 6);
    expect(a.b).toBeCloseTo(b.b, 4);
  });

  it('днём слоя нет, ночью — глубокий синий 0,6–0,7', () => {
    expect(shadeAt(0.3).a).toBe(0);
    for (const p of [0.7, 0.8, 0.9, 0.98]) {
      const s = shadeAt(p);
      expect(s.a).toBeGreaterThanOrEqual(0.6);
      expect(s.a).toBeLessThanOrEqual(0.7);
      expect(s.b).toBeGreaterThan(s.r);
    }
    expect(nightness(0.3)).toBe(0);
    expect(nightness(0.8)).toBe(1);
  });

  it('фонари зажигаются по очереди на закате, ночью горят все, днём — ни один', () => {
    const lamps = Array.from({ length: 24 }, (_, i) => i);
    expect(lamps.every((i) => lampsOn(0.8, i))).toBe(true);
    expect(lamps.some((i) => lampsOn(0.3, i))).toBe(false);
    // Посреди заката одни уже горят, другие ещё нет.
    const mid = lamps.filter((i) => lampsOn(0.6125, i)).length;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(lamps.length);
    // Каждый, раз загоревшись, горит до утра.
    for (const i of lamps) {
      let was = false;
      for (let p = 0.575; p < 1; p += 0.001) {
        const on = lampsOn(p, i);
        if (was) expect(on).toBe(true);
        was = on;
      }
    }
  });
});
