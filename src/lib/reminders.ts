import type { Obligation, RecurringPayment, ReminderPrefs } from '@/types';
import { collectPayments, computeObligation, computeRecurring } from '@/lib/finance-calc';
import { addDays, parseISO, toISO, todayISO } from '@/lib/date';

interface ReminderItem {
  key: string;
  name: string;
  amount: number;
  dueDate: string;
  fireAt: number; // absolute ms (computed in the device's local/Moscow time)
}

const DAY = 86400000;

/** Local midnight today (ms) — so a same-day reminder still fires if its time already passed. */
function todayStartMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Auto fire time: (dueDate − leadDays) at the global hour:minute, in local ms. */
function autoFireAt(dueISO: string, prefs: ReminderPrefs): number {
  const d = parseISO(dueISO);
  if (!d) return 0;
  d.setDate(d.getDate() - prefs.leadDays);
  d.setHours(prefs.hour, prefs.minute, 0, 0);
  return d.getTime();
}

/**
 * Build absolute-timestamp reminders for the server. Items with a custom
 * `notifyAt` become a single one-shot; the rest use the global lead/time per
 * upcoming occurrence (next 120 days).
 */
export function buildReminders(
  expenses: Obligation[],
  recurring: RecurringPayment[],
  prefs: ReminderPrefs,
): ReminderItem[] {
  if (!prefs.enabled) return [];
  const out: ReminderItem[] = [];
  const floor = todayStartMs();
  const horizon = Date.now() + 120 * DAY;

  // Custom one-shot reminders (explicit date+time chosen on the payment).
  for (const o of expenses) {
    if (o.notify === false || o.status === 'closed' || !o.notifyAt) continue;
    const fireAt = new Date(o.notifyAt).getTime();
    if (!Number.isFinite(fireAt) || fireAt < floor || fireAt > horizon) continue;
    out.push({
      key: `obligation:${o.id}:custom`,
      name: o.name,
      amount: computeObligation(o).monthlyPayment,
      dueDate: computeObligation(o).nextPaymentDate || todayISO(),
      fireAt,
    });
  }
  for (const r of recurring) {
    if (r.notify === false || r.paused || !r.notifyAt) continue;
    const fireAt = new Date(r.notifyAt).getTime();
    if (!Number.isFinite(fireAt) || fireAt < floor || fireAt > horizon) continue;
    out.push({
      key: `recurring:${r.id}:custom`,
      name: r.name,
      amount: r.amount,
      dueDate: computeRecurring(r).nextDue,
      fireAt,
    });
  }

  // Auto reminders (no custom time) — one per upcoming occurrence.
  const autoIds = new Set<string>([
    ...expenses.filter((o) => o.notify !== false && o.status !== 'closed' && !o.notifyAt).map((o) => o.id),
    ...recurring.filter((r) => r.notify !== false && !r.paused && !r.notifyAt).map((r) => r.id),
  ]);
  const from = todayISO();
  const until = toISO(addDays(parseISO(from) ?? new Date(), 120));
  for (const p of collectPayments(from, until, expenses, recurring)) {
    if (!autoIds.has(p.id)) continue;
    const fireAt = autoFireAt(p.date, prefs);
    if (!fireAt || fireAt < floor || fireAt > horizon) continue;
    out.push({ key: `${p.kind}:${p.id}:${p.date}`, name: p.name, amount: p.amount, dueDate: p.date, fireAt });
  }

  return out.slice(0, 300);
}

/** Push reminders to the server (no-op in dev — the mocked initData won't validate). */
export async function syncReminders(
  rawInitData: string | undefined,
  prefs: ReminderPrefs,
  expenses: Obligation[],
  recurring: RecurringPayment[],
): Promise<void> {
  if (!rawInitData || import.meta.env.DEV) return;
  const reminders = buildReminders(expenses, recurring, prefs);
  try {
    await fetch('/api/reminders/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: rawInitData, reminders }),
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
