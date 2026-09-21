import { describe, expect, it } from 'vitest';
import { digitCount, moneyText } from './money';

const NBSP = ' ';

describe('сумма на счётчике', () => {
  it('разряды разбиты по три, начиная с конца', () => {
    expect(moneyText(0)).toBe('0');
    expect(moneyText(7)).toBe('7');
    expect(moneyText(999)).toBe('999');
    expect(moneyText(1000)).toBe(`1${NBSP}000`);
    expect(moneyText(12345)).toBe(`12${NBSP}345`);
    expect(moneyText(123456)).toBe(`123${NBSP}456`);
    expect(moneyText(1234567)).toBe(`1${NBSP}234${NBSP}567`);
    expect(moneyText(900000000)).toBe(`900${NBSP}000${NBSP}000`);
  });

  it('разделитель неразрывный — число не переносится по разрядам', () => {
    expect(moneyText(1_000_000)).not.toContain(' ');
    expect(moneyText(1_000_000).split(NBSP)).toHaveLength(3);
  });

  it('дробное округляется, отрицательного не бывает', () => {
    expect(moneyText(12.4)).toBe('12');
    expect(moneyText(12.6)).toBe('13');
    expect(moneyText(-5)).toBe('0');
  });

  it('счёт разрядов совпадает с тем, что показано', () => {
    for (const v of [0, 9, 10, 99, 100, 999, 1000, 99999, 1e6]) {
      expect(digitCount(v)).toBe(moneyText(v).replace(new RegExp(NBSP, 'g'), '').length);
    }
  });
});
