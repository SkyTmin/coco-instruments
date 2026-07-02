import { describe, expect, it } from 'vitest';

import type { IncomeSource, SalaryConfig } from '@/types';
import { autoKindFor, computePayslip, monthDays, payslipRangeTotal, workStats } from '@/lib/salary';

const src = (salary: SalaryConfig, over: Partial<IncomeSource> = {}): IncomeSource => ({
  id: 's1',
  name: 'Вахта',
  scheme: 'vahta',
  startDate: '2026-07-01',
  createdAt: 0,
  updatedAt: 0,
  salary,
  ...over,
});

describe('календарь (авто-цикл + ручные отметки)', () => {
  it('размечает месяц по циклу 15/15 от startDate', () => {
    const s = src({ rateMode: 'daily', dayRate: 5000 }, { onDays: 15, offDays: 15 });
    expect(autoKindFor(s, '2026-07-01')).toBe('work');
    expect(autoKindFor(s, '2026-07-15')).toBe('work');
    expect(autoKindFor(s, '2026-07-16')).toBe('off');
    expect(autoKindFor(s, '2026-07-31')).toBe('work'); // новый цикл с 31-го
  });

  it('ручная отметка перекрывает авто-цикл', () => {
    const s = src(
      { rateMode: 'daily', dayRate: 5000 },
      { onDays: 15, offDays: 15, calendar: { '2026-07-16': { kind: 'work', night: true } } },
    );
    const days = monthDays(s, '2026-07');
    const d16 = days.find((d) => d.date === '2026-07-16')!;
    expect(d16.mark.kind).toBe('work');
    expect(d16.manual).toBe(true);
    // 15 по циклу (1–15) + 31-е (новый цикл) + 1 ручной день = 17
    expect(workStats(days).workDays).toBe(17);
    expect(workStats(days).nightShifts).toBe(1);
  });
});

describe('computePayslip — почасовая ставка', () => {
  it('база = ставка × часы × смены', () => {
    // Июль 2026, цикл 30/30 со старта 1 июля → все 31 день рабочие... нет:
    // on=30 → 1..30 work, 31-е — off. 30 смен × 11 ч × 300 ₽ = 99 000.
    const s = src(
      { rateMode: 'hourly', hourRate: 300, shiftHours: 11 },
      { onDays: 30, offDays: 30 },
    );
    const p = computePayslip(s, '2026-07');
    expect(p.stats.workDays).toBe(30);
    expect(p.gross).toBe(300 * 11 * 30);
    expect(p.net).toBe(p.gross); // НДФЛ выключен
  });

  it('полный лист: премия, коэффициенты, вахтовая, НДФЛ', () => {
    const s = src(
      {
        rateMode: 'hourly',
        hourRate: 300,
        shiftHours: 10,
        premiumEnabled: true,
        premiumMode: 'percent',
        premiumValue: 20,
        districtEnabled: true,
        districtCoeff: 1.5,
        northEnabled: true,
        northPercent: 50,
        vahtaEnabled: true,
        vahtaAllowancePerDay: 700,
        ndflEnabled: true,
        ndflPercent: 13,
      },
      { onDays: 10, offDays: 21 }, // период 31 день — июль не зацикливается
    );
    const p = computePayslip(s, '2026-07');
    // база 300×10×10 = 30000; премия 20% = 6000; тело = 36000
    // районный +0.5×36000 = 18000; северная +50% = 18000 → тело 72000
    // вахтовая 700×10 = 7000 (без коэффициентов); gross = 79000
    // НДФЛ 13% от 72000 = 9360; net = 69640
    expect(p.gross).toBe(79000);
    expect(p.deductions[0].amount).toBe(9360);
    expect(p.net).toBe(69640);
    // аванс по умолчанию 45%
    expect(p.advance).toBe(Math.round(69640 * 0.45));
    expect(p.advance + p.salary).toBe(p.net);
  });

  it('ночные, праздничные и сверхурочные считаются от часовой', () => {
    const s = src(
      {
        rateMode: 'hourly',
        hourRate: 200,
        shiftHours: 10,
        nightEnabled: true,
        nightPercent: 20,
        nightHoursPerShift: 8,
        holidayEnabled: true,
        holidayMultiplier: 2,
        overtimeEnabled: true,
        overtimeMultiplier: 2,
      },
      {
        onDays: 0,
        offDays: 0,
        calendar: {
          '2026-07-01': { kind: 'work' },
          '2026-07-02': { kind: 'work', night: true },
          '2026-07-03': { kind: 'holiday' },
          '2026-07-04': { kind: 'work', overtimeHours: 2 },
        },
      },
    );
    const p = computePayslip(s, '2026-07');
    // база: 4 смены × 10 ч × 200 = 8000
    // ночные: 200 × 20% × 8 = 320
    // праздничные: (2−1) × (200×10) × 1 = 2000
    // сверхурочные: 200 × 2 × 2 = 800
    expect(p.stats.workDays).toBe(4);
    expect(p.gross).toBe(8000 + 320 + 2000 + 800);
  });
});

describe('computePayslip — дневная ставка и оклад', () => {
  it('дневная: ставка × смены', () => {
    const s = src({ rateMode: 'daily', dayRate: 5000 }, { onDays: 15, offDays: 15 });
    const p = computePayslip(s, '2026-07');
    expect(p.gross).toBe(5000 * 16); // 1–15 work + 31-е (новый цикл)
  });

  it('оклад: фиксированная база, НДФЛ уменьшает «на руки»', () => {
    const s = src(
      { rateMode: 'monthly', monthlyBase: 100000, ndflEnabled: true, ndflPercent: 13 },
      { onDays: 30, offDays: 0 },
    );
    const p = computePayslip(s, '2026-07');
    expect(p.gross).toBe(100000);
    expect(p.net).toBe(87000);
  });
});

describe('payslipRangeTotal (прогноз за вахту)', () => {
  it('суммирует месяцы', () => {
    const s = src({ rateMode: 'daily', dayRate: 1000 }, { onDays: 30, offDays: 30 });
    const total = payslipRangeTotal(s, ['2026-07', '2026-08']);
    const jul = computePayslip(s, '2026-07');
    const aug = computePayslip(s, '2026-08');
    expect(total.net).toBe(jul.net + aug.net);
    expect(total.advance + total.salary).toBe(total.net);
  });
});
