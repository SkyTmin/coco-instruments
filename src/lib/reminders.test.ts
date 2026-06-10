import { describe, expect, it } from 'vitest';
import type { Obligation, RecurringPayment, ReminderPrefs } from '@/types';
import { buildReminders } from './reminders';
import { todayISO } from './date';

const prefs: ReminderPrefs = { enabled: true, leads: [0], hour: 9, minute: 0 };

function rec(p: Partial<RecurringPayment> = {}): RecurringPayment {
  return {
    id: 'r1',
    name: 'Подписка',
    amount: 299,
    intervalCount: 1,
    intervalUnit: 'month',
    startDate: todayISO(),
    createdAt: 0,
    updatedAt: 0,
    ...p,
  };
}

describe('buildReminders', () => {
  it('returns nothing when globally disabled', () => {
    expect(buildReminders([], [rec()], { ...prefs, enabled: false })).toEqual([]);
  });

  it('builds an auto reminder (lead 0) for an upcoming recurring charge', () => {
    const out = buildReminders([], [rec()], prefs);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.every((r) => r.key.endsWith(':l0'))).toBe(true);
    expect(out[0].name).toBe('Подписка');
    expect(typeof out[0].fireAt).toBe('number');
  });

  it('honors multiple lead-days (per item)', () => {
    const out = buildReminders([], [rec({ notifyLeads: [0, 1] })], prefs);
    expect(out.some((r) => r.key.endsWith(':l1'))).toBe(true);
    expect(out.some((r) => r.key.endsWith(':l0'))).toBe(true);
  });

  it('uses a per-item custom time', () => {
    const out = buildReminders([], [rec({ notifyLeads: [0], notifyTime: '20:30' })], prefs);
    const d = new Date(out[0].fireAt);
    expect(d.getHours()).toBe(20);
    expect(d.getMinutes()).toBe(30);
  });

  it('excludes items with notify === false', () => {
    expect(buildReminders([], [rec({ notify: false })], prefs)).toEqual([]);
  });

  it('an obligation also produces reminders', () => {
    const o: Obligation = {
      id: 'o1',
      name: 'Кредит',
      type: 'credit',
      principalAmount: 100000,
      monthlyPayment: 5000,
      paymentDay: 15,
      termMonths: 12,
      startDate: todayISO(),
      status: 'active',
      payments: [],
      createdAt: 0,
      updatedAt: 0,
    };
    expect(buildReminders([o], [], prefs).length).toBeGreaterThanOrEqual(1);
  });
});
