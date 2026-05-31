import type { Obligation, RecurringPayment, ReminderPrefs } from '@/types';
import { collectPayments } from '@/lib/finance-calc';
import { addDays, parseISO, toISO, todayISO } from '@/lib/date';

interface ReminderItem {
  key: string;
  name: string;
  amount: number;
  dueDate: string;
  fireAt: number; // absolute ms, computed in the device's local/Moscow time
}

const DAY = 86400000;

function todayStartMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Parse "HH:MM" → {h,m}, falling back to the global prefs time. */
function parseTime(t: string | undefined, prefs: ReminderPrefs): { h: number; m: number } {
  if (t && /^\d{1,2}:\d{2}/.test(t)) {
    const [h, m] = t.split(':').map(Number);
    return { h: h || 0, m: m || 0 };
  }
  return { h: prefs.hour, m: prefs.minute };
}

/** Fire time for a due date and a lead, at a given hour:minute, in local ms. */
function fireAtFor(dueISO: string, lead: number, h: number, m: number): number {
  const d = parseISO(dueISO);
  if (!d) return 0;
  d.setDate(d.getDate() - lead);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/**
 * Build absolute-timestamp reminders for the server: one per upcoming
 * occurrence × chosen lead-day. Per-item leads/time override the global prefs.
 */
export function buildReminders(
  expenses: Obligation[],
  recurring: RecurringPayment[],
  prefs: ReminderPrefs,
): ReminderItem[] {
  if (!prefs.enabled) return [];

  const cfg = new Map<string, { leads: number[]; time?: string }>();
  for (const o of expenses) {
    if (o.notify === false || o.status === 'closed') continue;
    cfg.set(o.id, { leads: o.notifyLeads ?? [], time: o.notifyTime });
  }
  for (const r of recurring) {
    if (r.notify === false || r.paused) continue;
    cfg.set(r.id, { leads: r.notifyLeads ?? [], time: r.notifyTime });
  }
  if (cfg.size === 0) return [];

  const floor = todayStartMs();
  const horizon = Date.now() + 120 * DAY;
  const from = todayISO();
  const until = toISO(addDays(parseISO(from) ?? new Date(), 120));
  const out: ReminderItem[] = [];

  for (const p of collectPayments(from, until, expenses, recurring)) {
    const c = cfg.get(p.id);
    if (!c) continue;
    const leads = c.leads.length ? c.leads : prefs.leads.length ? prefs.leads : [0];
    const { h, m } = parseTime(c.time, prefs);
    for (const lead of leads) {
      const fireAt = fireAtFor(p.date, lead, h, m);
      if (!fireAt || fireAt < floor || fireAt > horizon) continue;
      out.push({
        key: `${p.kind}:${p.id}:${p.date}:l${lead}`,
        name: p.name,
        amount: p.amount,
        dueDate: p.date,
        fireAt,
      });
    }
  }
  return out.slice(0, 400);
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
