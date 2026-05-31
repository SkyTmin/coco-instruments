import type { Obligation, RecurringPayment, ReminderPrefs } from '@/types';
import { collectPayments } from '@/lib/finance-calc';
import { addDays, parseISO, toISO, todayISO } from '@/lib/date';

interface ReminderPayment {
  key: string;
  name: string;
  date: string;
  amount: number;
}

/** Build the list of upcoming notify-enabled payments to hand to the server. */
export function buildReminderPayments(
  expenses: Obligation[],
  recurring: RecurringPayment[],
): ReminderPayment[] {
  const ids = new Set<string>([
    ...expenses.filter((o) => o.notify !== false && o.status !== 'closed').map((o) => o.id),
    ...recurring.filter((r) => r.notify !== false && !r.paused).map((r) => r.id),
  ]);
  const from = todayISO();
  const until = toISO(addDays(parseISO(from) ?? new Date(), 120));
  return collectPayments(from, until, expenses, recurring)
    .filter((p) => ids.has(p.id))
    .map((p) => ({ key: `${p.kind}:${p.id}:${p.date}`, name: p.name, date: p.date, amount: p.amount }));
}

/**
 * Push the user's reminder prefs + upcoming payments to the server, which sends
 * the actual Telegram messages. No-op in dev (the mocked initData won't validate).
 */
export async function syncReminders(
  rawInitData: string | undefined,
  prefs: ReminderPrefs,
  expenses: Obligation[],
  recurring: RecurringPayment[],
): Promise<void> {
  if (!rawInitData || import.meta.env.DEV) return;
  const payments = prefs.enabled ? buildReminderPayments(expenses, recurring) : [];
  try {
    await fetch('/api/reminders/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initData: rawInitData,
        tzOffset: -new Date().getTimezoneOffset(), // e.g. Moscow → +180
        prefs: {
          enabled: prefs.enabled,
          leadDays: prefs.leadDays,
          hour: prefs.hour,
          minute: prefs.minute,
        },
        payments,
      }),
    });
  } catch {
    /* offline — will re-sync next time */
  }
}

/** Ask the server to send a test reminder right now. */
export async function testReminder(
  rawInitData: string | undefined,
): Promise<{ ok: boolean; error?: string }> {
  if (!rawInitData) return { ok: false, error: 'no_init_data' };
  try {
    const r = await fetch('/api/reminders/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: rawInitData }),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
