import { describe, expect, it } from 'vitest';

import { parsePayslipText } from '@/lib/payslip-import';

const SAMPLE = `
РАСЧЕТНЫЙ ЛИСТОК за март 2026
Иванов И.И.  Табельный № 4512  Подразделение: Буровая бригада №3
Часовая тарифная ставка 352,50
Начислено:
  Оплата по тарифу (176 час.)            62 040,00
  Премия ежемесячная 30 %                18 612,00
  Доплата за ночные часы 40 % (48 час.)   6 768,00
  Районный коэффициент 1,7               61 191,36
  Северная надбавка 80 %                 69 936,00
  Надбавка за вахтовый метод работы (30 дн. по 700,00)  21 000,00
Удержано:
  НДФЛ 13 %                              28 402,00
Итого к выплате:                        211 145,36
`;

describe('parsePayslipText', () => {
  it('распознаёт все ключевые параметры из типового листка', () => {
    const { config, found } = parsePayslipText(SAMPLE);
    expect(config.rateMode).toBe('hourly');
    expect(config.hourRate).toBe(352.5);
    expect(config.premiumEnabled).toBe(true);
    expect(config.premiumMode).toBe('percent');
    expect(config.premiumValue).toBe(30);
    expect(config.nightEnabled).toBe(true);
    expect(config.nightPercent).toBe(40);
    expect(config.districtEnabled).toBe(true);
    expect(config.districtCoeff).toBe(1.7);
    expect(config.northEnabled).toBe(true);
    expect(config.northPercent).toBe(80);
    expect(config.vahtaEnabled).toBe(true);
    expect(config.vahtaAllowancePerDay).toBe(700);
    expect(config.ndflEnabled).toBe(true);
    expect(config.ndflPercent).toBe(13);
    expect(found.length).toBeGreaterThanOrEqual(7);
  });

  it('распознаёт оклад, когда часовой ставки нет', () => {
    const { config } = parsePayslipText('Оклад 85 000,00 НДФЛ 13%');
    expect(config.rateMode).toBe('monthly');
    expect(config.monthlyBase).toBe(85000);
    expect(config.ndflPercent).toBe(13);
  });

  it('районный коэффициент в процентах приводится к множителю', () => {
    const { config } = parsePayslipText('Районный коэффициент 70 % 12 345');
    expect(config.districtCoeff).toBe(1.7);
  });

  it('пустой текст → ничего не найдено', () => {
    const { config, found } = parsePayslipText('накладная на груз 25 тонн');
    expect(found).toHaveLength(0);
    expect(Object.keys(config)).toHaveLength(0);
  });
});
