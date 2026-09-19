import { describe, expect, it } from 'vitest';
import { HIT_STOP, noise1, TRAUMA } from './juice';

describe('гладкий шум для тряски', () => {
  it('держится в [-1, 1]', () => {
    for (let i = 0; i < 2000; i++) {
      const v = noise1(i * 0.37);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('детерминирован: те же входы — тот же результат', () => {
    expect(noise1(12.34)).toBe(noise1(12.34));
    expect(noise1(-5.5)).toBe(noise1(-5.5));
  });

  it('гладкий, а не дёрганый — соседние кадры рядом', () => {
    // Ради этого шум и взят вместо Math.random: случайное число на кадр
    // выглядит как сломанный телевизор. Шаг 1/60 секунды при скорости 20
    // единиц/с — это 0.33 по оси шума; скачок должен быть небольшим.
    let worst = 0;
    for (let x = 0; x < 300; x += 0.33) {
      worst = Math.max(worst, Math.abs(noise1(x + 0.33) - noise1(x)));
    }
    expect(worst).toBeLessThan(1.6);
  });

  it('в целых точках совпадает сам с собой с обеих сторон', () => {
    // Значение в узле не зависит от того, с какой стороны к нему подходить.
    for (const n of [3, 17, 42]) {
      expect(noise1(n + 1e-9)).toBeCloseTo(noise1(n), 6);
      expect(noise1(n - 1e-9)).toBeCloseTo(noise1(n), 6);
    }
  });

  it('оси со сдвигом не ходят синхронно', () => {
    // В tickShake оси берут шум со сдвигами 0 / 100 / 200. Если бы они
    // совпадали, тряска шла бы строго по диагонали.
    let same = 0;
    for (let i = 0; i < 500; i++) {
      const x = i * 0.31;
      if (Math.abs(noise1(x) - noise1(x + 100)) < 0.01) same++;
    }
    expect(same).toBeLessThan(25);
  });
});

describe('ступени силы', () => {
  it('стоп-кадр растёт вместе с выигрышем', () => {
    expect(HIT_STOP.small).toBeLessThan(HIT_STOP.big);
    expect(HIT_STOP.big).toBeLessThan(HIT_STOP.mega);
    // Больше 200 мс уже читается как подвисание, а не как удар.
    expect(HIT_STOP.mega).toBeLessThanOrEqual(200);
  });

  it('травма растёт вместе с выигрышем и не выходит за единицу', () => {
    expect(TRAUMA.small).toBeLessThan(TRAUMA.big);
    expect(TRAUMA.big).toBeLessThan(TRAUMA.mega);
    expect(TRAUMA.mega).toBeLessThanOrEqual(1);
  });
});
