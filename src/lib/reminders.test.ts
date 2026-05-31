import { describe, expect, it } from 'vitest';
import type { Obligation, RecurringPayment, ReminderPrefs } from '@/types';
import { buildReminders } from './reminders';
import { addDays, toISO, todayISO } from './date';

const prefs: ReminderPrefs = { enabled: true, leadDays: 0, hour: 9, minute: 0 };

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

function obl(p: Partial<Obligation> = {}): Obligation {
  return {
    id: 'o1',
    name: 'Кредит',
    type: 'single',
    principalAmount: 5000,
    paymentDay: 1,
    termMonths: 1,
    startDate: todayISO(),
    status: 'active',
    payments: [],
    createdAt: 0,
    updatedAt: 0,
    ...p,
  };
}

describe('buildReminders', () => {
  it('returns nothing when globally disabled', () => {
    expect(buildReminders([], [rec()], { ...prefs, enabled: false })).toEqual([]);
  });

  it('builds auto reminders for upcoming recurring charges', () => {
    const out = buildReminders([], [rec()], prefs);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].name).toBe('Подписка');
    expect(typeof out[0].fireAt).toBe('number');
    expect(out[0].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('honors a custom notifyAt as a one-shot reminder', () => {
    const d = addDays(new Date(), 3);
    const localISO = `${toISO(d)}T08:30`;
    const out = buildReminders([obl({ notifyAt: localISO })], [], prefs);
    const custom = out.find((r) => r.key.endsWith(':custom'));
    expect(custom).toBeTruthy();
    expect(custom!.fireAt).toBe(new Date(localISO).getTime());
  });

  it('excludes items with notify === false', () => {
    expect(buildReminders([], [rec({ notify: false })], prefs)).toEqual([]);
  });
});
