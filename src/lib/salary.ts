// ---------------------------------------------------------------------------
// SalaryCalculator — универсальный расчёт зарплаты вахтовика/сменщика.
//
// Чистая математика без UI: экраны только отображают результат. Вход —
// IncomeSource с SalaryConfig (+ ручной календарь), выход — Payslip
// («расчётный лист»: построчно начислено / удержано / к выплате).
//
// Порядок расчёта (упрощённая, но честная модель, допущения помечены):
//   1. База          = ставка × отработанное (часы | смены | оклад).
//   2. Ночные        = ставка/час × ночные часы × night%.
//   3. Праздничные   = дневной заработок × (множитель − 1) за праздничные смены.
//   4. Сверхурочные  = ставка/час × часы переработки × множитель.
//   5. Премия и надбавка за особые условия (% от базы или фикс).
//   6. «Тело» (1–5) × районный коэффициент × (1 + северная%).
//      Вахтовая надбавка коэффициентами НЕ умножается (ТК ст.302).
//   7. Вахтовая надбавка = ₽/день × рабочие календарные дни; НДФЛ не облагается
//      (в пределах норматива 700 ₽/день по РФ — за лимитом упрощаем).
//   8. НДФЛ = % × облагаемое (тело с коэффициентами). Итог «на руки».
//   9. Аванс/зарплата: net × advance% в день аванса, остаток — в день зарплаты.
// ---------------------------------------------------------------------------

import type { IncomeSource, SalaryConfig, WorkDayKind, WorkDayMark } from '@/types';
import { daysInMonth, parseISO, toISO } from '@/lib/date';

export const DEFAULT_NDFL_PERCENT = 13;
export const DEFAULT_HOLIDAY_MULTIPLIER = 2;
export const DEFAULT_OVERTIME_MULTIPLIER = 2;
export const DEFAULT_NIGHT_HOURS = 8;
export const DEFAULT_SHIFT_HOURS = 11;

const rub = (n: number) => Math.round(n) || 0;

// ---- Календарь месяца ------------------------------------------------------

export interface MonthDay {
  date: string; // ISO
  mark: WorkDayMark;
  /** true когда отметка проставлена вручную (а не выведена из цикла). */
  manual: boolean;
}

/** Auto day kind from the on/off cycle anchored at src.startDate. */
export function autoKindFor(src: IncomeSource, iso: string): WorkDayKind {
  const on = src.onDays || 0;
  const off = src.offDays || 0;
  if (on <= 0) return 'off';
  const start = parseISO(src.startDate);
  const day = parseISO(iso);
  if (!start || !day) return 'off';
  const diff = Math.floor((day.getTime() - start.getTime()) / 86400000);
  if (diff < 0) return 'off';
  if (off <= 0) return 'work';
  const pos = diff % (on + off);
  return pos < on ? 'work' : 'off';
}

/**
 * Every day of a month with its effective mark: manual calendar entry when
 * present, otherwise the auto cycle. `month` is 'YYYY-MM'.
 */
export function monthDays(src: IncomeSource, month: string): MonthDay[] {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return [];
  const total = daysInMonth(y, m);
  const out: MonthDay[] = [];
  for (let d = 1; d <= total; d++) {
    const date = toISO(new Date(y, m - 1, d));
    const manual = src.calendar?.[date];
    out.push({
      date,
      mark: manual ?? { kind: autoKindFor(src, date) },
      manual: !!manual,
    });
  }
  return out;
}

// ---- Расчётный лист --------------------------------------------------------

export interface PayslipLine {
  id: string;
  label: string;
  amount: number;
}

export interface WorkStats {
  workDays: number; // рабочие + праздничные смены
  holidayDays: number;
  nightShifts: number;
  overtimeHours: number;
  hours: number; // всего рабочих часов (без переработки)
}

export interface Payslip {
  month: string; // 'YYYY-MM'
  stats: WorkStats;
  accruals: PayslipLine[];
  gross: number; // «грязными»
  deductions: PayslipLine[];
  net: number; // «на руки» (равно gross, если НДФЛ выключен)
  advance: number; // выплата в день аванса
  salary: number; // выплата в день зарплаты (остаток)
}

/** Собрать статистику смен за месяц по эффективному календарю. */
export function workStats(days: MonthDay[]): WorkStats {
  const s: WorkStats = { workDays: 0, holidayDays: 0, nightShifts: 0, overtimeHours: 0, hours: 0 };
  for (const d of days) {
    if (d.mark.kind === 'off') continue;
    s.workDays += 1;
    if (d.mark.kind === 'holiday') s.holidayDays += 1;
    if (d.mark.night) s.nightShifts += 1;
    s.overtimeHours += d.mark.overtimeHours || 0;
  }
  return s;
}

/** Legacy-мост: собрать SalaryConfig из старых плоских полей IncomeSource. */
export function salaryConfigOf(src: IncomeSource): SalaryConfig {
  if (src.salary) return src.salary;
  if (src.scheme === 'shift') {
    return {
      rateMode: 'hourly',
      hourRate: src.hourRate,
      shiftHours: src.shiftHours ?? 12,
      nightEnabled: false,
      districtEnabled: !!src.districtCoeff && src.districtCoeff !== 1,
      districtCoeff: src.districtCoeff,
      northEnabled: !!src.northPercent,
      northPercent: src.northPercent,
    };
  }
  // vahta / salary
  return {
    rateMode: src.dayRate ? 'daily' : 'monthly',
    dayRate: src.dayRate,
    monthlyBase: src.monthlyNet,
    shiftHours: src.shiftHours ?? DEFAULT_SHIFT_HOURS,
    vahtaEnabled: !!src.vahtaAllowancePerDay,
    vahtaAllowancePerDay: src.vahtaAllowancePerDay,
    districtEnabled: !!src.districtCoeff && src.districtCoeff !== 1,
    districtCoeff: src.districtCoeff,
    northEnabled: !!src.northPercent,
    northPercent: src.northPercent,
  };
}

/** Часовая ставка-эквивалент (для ночных/сверхурочных при любом режиме). */
function hourEquiv(cfg: SalaryConfig, stats: WorkStats): number {
  const shiftHours = cfg.shiftHours || DEFAULT_SHIFT_HOURS;
  if (cfg.rateMode === 'hourly') return cfg.hourRate || 0;
  if (cfg.rateMode === 'daily') return (cfg.dayRate || 0) / Math.max(1, shiftHours);
  // monthly: оклад / фактические часы месяца (упрощение)
  return (cfg.monthlyBase || 0) / Math.max(1, stats.hours);
}

/** Дневной заработок одной смены (для праздничного множителя). */
function dayPay(cfg: SalaryConfig): number {
  const shiftHours = cfg.shiftHours || DEFAULT_SHIFT_HOURS;
  if (cfg.rateMode === 'hourly') return (cfg.hourRate || 0) * shiftHours;
  if (cfg.rateMode === 'daily') return cfg.dayRate || 0;
  return 0; // monthly: праздничная доплата считается от часовой (ниже)
}

/**
 * Расчётный лист источника за месяц. Все суммы в ₽, округлены.
 * Дни берутся из эффективного календаря (ручные отметки поверх цикла).
 */
export function computePayslip(src: IncomeSource, month: string): Payslip {
  const cfg = salaryConfigOf(src);
  const days = monthDays(src, month);
  const stats = workStats(days);
  const shiftHours = cfg.shiftHours || DEFAULT_SHIFT_HOURS;
  stats.hours = stats.workDays * shiftHours;

  const accruals: PayslipLine[] = [];
  const add = (id: string, label: string, amount: number) => {
    const a = rub(amount);
    if (a > 0) accruals.push({ id, label, amount: a });
  };

  // 1. База
  let base = 0;
  if (cfg.rateMode === 'hourly') base = (cfg.hourRate || 0) * stats.hours;
  else if (cfg.rateMode === 'daily') base = (cfg.dayRate || 0) * stats.workDays;
  else base = stats.workDays > 0 || !src.calendar ? cfg.monthlyBase || 0 : 0;
  add('base', cfg.rateMode === 'monthly' ? 'Оклад' : 'Оплата по ставке', base);

  const perHour = hourEquiv(cfg, stats);

  // 2. Ночные
  let night = 0;
  if (cfg.nightEnabled) {
    const nightHours = stats.nightShifts * (cfg.nightHoursPerShift ?? DEFAULT_NIGHT_HOURS);
    night = perHour * ((cfg.nightPercent ?? 20) / 100) * nightHours;
    add('night', 'Ночные часы', night);
  }

  // 3. Праздничные (доплата сверх одинарной, которая уже в базе)
  let holiday = 0;
  if (cfg.holidayEnabled && stats.holidayDays > 0) {
    const mult = (cfg.holidayMultiplier ?? DEFAULT_HOLIDAY_MULTIPLIER) - 1;
    const oneDay = cfg.rateMode === 'monthly' ? perHour * shiftHours : dayPay(cfg);
    holiday = oneDay * mult * stats.holidayDays;
    add('holiday', 'Праздничные смены', holiday);
  }

  // 4. Сверхурочные
  let overtime = 0;
  if (cfg.overtimeEnabled && stats.overtimeHours > 0) {
    overtime =
      perHour * (cfg.overtimeMultiplier ?? DEFAULT_OVERTIME_MULTIPLIER) * stats.overtimeHours;
    add('overtime', 'Сверхурочные', overtime);
  }

  // 5. Премия и особые условия
  let premium = 0;
  if (cfg.premiumEnabled && cfg.premiumValue) {
    premium = cfg.premiumMode === 'fixed' ? cfg.premiumValue : base * (cfg.premiumValue / 100);
    add('premium', 'Премия', premium);
  }
  let special = 0;
  if (cfg.specialEnabled && cfg.specialValue) {
    special = cfg.specialMode === 'fixed' ? cfg.specialValue : base * (cfg.specialValue / 100);
    add('special', 'Особые условия', special);
  }

  // 6. Коэффициенты на «тело»
  const body = base + night + holiday + overtime + premium + special;
  let bodyFinal = body;
  if (cfg.districtEnabled && (cfg.districtCoeff || 0) > 0) {
    const extra = body * ((cfg.districtCoeff || 1) - 1);
    bodyFinal += extra;
    add('district', `Районный коэффициент ×${cfg.districtCoeff}`, extra);
  }
  if (cfg.northEnabled && (cfg.northPercent || 0) > 0) {
    const extra = body * ((cfg.northPercent || 0) / 100);
    bodyFinal += extra;
    add('north', `Северная надбавка ${cfg.northPercent}%`, extra);
  }

  // 7. Вахтовая надбавка (без коэффициентов, без НДФЛ)
  let allowance = 0;
  if (cfg.vahtaEnabled && (cfg.vahtaAllowancePerDay || 0) > 0) {
    allowance = (cfg.vahtaAllowancePerDay || 0) * stats.workDays;
    add('vahta', 'Вахтовая надбавка', allowance);
  }

  const gross = rub(bodyFinal + allowance);

  // 8. НДФЛ
  const deductions: PayslipLine[] = [];
  let net = gross;
  if (cfg.ndflEnabled) {
    const pct = cfg.ndflPercent ?? DEFAULT_NDFL_PERCENT;
    const ndfl = rub(bodyFinal * (pct / 100));
    if (ndfl > 0) {
      deductions.push({ id: 'ndfl', label: `НДФЛ ${pct}%`, amount: ndfl });
      net = gross - ndfl;
    }
  }

  // 9. Аванс / зарплата
  const advPct = Math.min(90, Math.max(0, src.advancePercent ?? 45));
  const advance = rub(net * (advPct / 100));

  return {
    month,
    stats,
    accruals,
    gross,
    deductions,
    net,
    advance,
    salary: net - advance,
  };
}

/** Суммарный прогноз за диапазон месяцев (например, всю вахту). */
export function payslipRangeTotal(
  src: IncomeSource,
  months: string[],
): { gross: number; net: number; advance: number; salary: number } {
  let gross = 0;
  let net = 0;
  let advance = 0;
  let salary = 0;
  for (const m of months) {
    const p = computePayslip(src, m);
    gross += p.gross;
    net += p.net;
    advance += p.advance;
    salary += p.salary;
  }
  return { gross, net, advance, salary };
}

// ---- Шаблоны работодателей --------------------------------------------------
// Примерные стартовые пресеты (типичные параметры северных вахт) — пользователь
// корректирует под свой расчётный листок и сохраняет своим шаблоном.

export const BUILTIN_TEMPLATES: { name: string; config: SalaryConfig }[] = [
  {
    name: 'Газпром (примерно)',
    config: {
      rateMode: 'hourly',
      hourRate: 350,
      shiftHours: 11,
      premiumEnabled: true,
      premiumMode: 'percent',
      premiumValue: 30,
      districtEnabled: true,
      districtCoeff: 1.7,
      northEnabled: true,
      northPercent: 80,
      vahtaEnabled: true,
      vahtaAllowancePerDay: 700,
      nightEnabled: true,
      nightPercent: 40,
      nightHoursPerShift: 8,
      holidayEnabled: true,
      holidayMultiplier: 2,
      ndflEnabled: true,
      ndflPercent: 13,
    },
  },
  {
    name: 'Роснефть (примерно)',
    config: {
      rateMode: 'hourly',
      hourRate: 320,
      shiftHours: 11,
      premiumEnabled: true,
      premiumMode: 'percent',
      premiumValue: 25,
      districtEnabled: true,
      districtCoeff: 1.5,
      northEnabled: true,
      northPercent: 50,
      vahtaEnabled: true,
      vahtaAllowancePerDay: 700,
      nightEnabled: true,
      nightPercent: 20,
      nightHoursPerShift: 8,
      holidayEnabled: true,
      holidayMultiplier: 2,
      ndflEnabled: true,
      ndflPercent: 13,
    },
  },
  {
    name: 'СГТ (примерно)',
    config: {
      rateMode: 'daily',
      dayRate: 4500,
      shiftHours: 11,
      districtEnabled: true,
      districtCoeff: 1.7,
      northEnabled: true,
      northPercent: 50,
      vahtaEnabled: true,
      vahtaAllowancePerDay: 700,
      ndflEnabled: true,
      ndflPercent: 13,
    },
  },
  {
    name: 'Ямал (примерно)',
    config: {
      rateMode: 'hourly',
      hourRate: 300,
      shiftHours: 12,
      districtEnabled: true,
      districtCoeff: 1.8,
      northEnabled: true,
      northPercent: 80,
      vahtaEnabled: true,
      vahtaAllowancePerDay: 700,
      nightEnabled: true,
      nightPercent: 20,
      nightHoursPerShift: 8,
      ndflEnabled: true,
      ndflPercent: 13,
    },
  },
  {
    name: 'Полюс (примерно)',
    config: {
      rateMode: 'monthly',
      monthlyBase: 120000,
      shiftHours: 11,
      premiumEnabled: true,
      premiumMode: 'percent',
      premiumValue: 40,
      districtEnabled: true,
      districtCoeff: 1.4,
      northEnabled: true,
      northPercent: 50,
      vahtaEnabled: true,
      vahtaAllowancePerDay: 700,
      ndflEnabled: true,
      ndflPercent: 13,
    },
  },
];
