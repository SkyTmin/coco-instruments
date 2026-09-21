import { describe, expect, it } from 'vitest';
import { sepVisible, wheelCount, wheelPos } from './odometer';

describe('механический счётчик', () => {
  it('на круглом числе все колёса стоят ровно на своих цифрах', () => {
    // 4207 — ни одно колесо не должно быть между цифрами.
    [7, 0, 2, 4].forEach((digit, place) => {
      expect(wheelPos(4207, place)).toBeCloseTo(digit, 9);
    });
  });

  it('младший разряд крутится непрерывно — это и есть ход', () => {
    expect(wheelPos(3, 0)).toBeCloseTo(3, 9);
    expect(wheelPos(3.5, 0)).toBeCloseTo(3.5, 9);
    expect(wheelPos(9.9, 0)).toBeCloseTo(9.9, 9);
    // На десятке замыкается на ноль, а не уходит в 10.
    expect(wheelPos(10, 0)).toBeCloseTo(0, 9);
  });

  it('десятки поворачиваются ровно пока единицы идут с девятки на ноль', () => {
    expect(wheelPos(48, 1)).toBeCloseTo(4, 9);
    expect(wheelPos(48.9, 1)).toBeCloseTo(4, 9);
    // 49.0 — начало подхвата, 49.5 — середина, 50 — колесо на пятёрке.
    expect(wheelPos(49, 1)).toBeCloseTo(4, 9);
    expect(wheelPos(49.5, 1)).toBeCloseTo(4.5, 9);
    expect(wheelPos(50, 1)).toBeCloseTo(5, 9);
  });

  it('старшие разряды стоят намертво и щёлкают только в общий перевал', () => {
    // Это та самая ошибка, из-за которой счётчик выглядел сломанным: при
    // едином окне подхвата старший разряд здесь показывал бы половину
    // четвёрки с половиной пятёрки.
    expect(wheelPos(49_999_006, 7)).toBeCloseTo(4, 9);
    expect(wheelPos(49_999_999, 7)).toBeCloseTo(4, 6);
    // И только на самом перевале все колёса идут разом.
    expect(wheelPos(49_999_999.5, 7)).toBeCloseTo(4.5, 6);
    expect(wheelPos(50_000_000, 7)).toBeCloseTo(5, 9);
  });

  it('сотни ждут десятков, а не единиц', () => {
    expect(wheelPos(390, 2)).toBeCloseTo(3, 9);
    expect(wheelPos(398, 2)).toBeCloseTo(3, 9);
    expect(wheelPos(399, 2)).toBeCloseTo(3, 9);
    expect(wheelPos(399.5, 2)).toBeCloseTo(3.5, 9);
    expect(wheelPos(400, 2)).toBeCloseTo(4, 9);
  });

  it('ни одно колесо не выходит за свой оборот', () => {
    for (let i = 0; i < 4000; i++) {
      const v = Math.random() * 1e9;
      for (let p = 0; p < 9; p++) {
        const pos = wheelPos(v, p);
        expect(pos).toBeGreaterThanOrEqual(0);
        expect(pos).toBeLessThan(10);
      }
    }
  });

  it('разряды и разделители появляются вместе с числом', () => {
    expect(wheelCount(0)).toBe(1);
    expect(wheelCount(999)).toBe(3);
    expect(wheelCount(1000)).toBe(4);
    expect(wheelCount(7, 3)).toBe(3);
    // Разделитель после разряда тысяч виден с четвёртой цифры: «1 000».
    expect(sepVisible(3, 3)).toBe(false);
    expect(sepVisible(3, 4)).toBe(true);
    expect(sepVisible(6, 6)).toBe(false);
    expect(sepVisible(6, 7)).toBe(true);
  });
});
