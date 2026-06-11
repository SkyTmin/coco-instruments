import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LeadPicker, Screen } from '@/components/ui';
import type { IntervalUnit } from '@/types';
import { useFinanceStore, type RecurringDraft } from '@/store';
import { computeRecurring, monthlyEquivalent } from '@/lib/finance-calc';
import { todayISO } from '@/lib/date';
import { formatDate, formatRUB, intervalLabel } from '@/lib/format';
import { notifySuccess, selectionChanged } from '@/lib/haptics';

const UNITS: { value: IntervalUnit; label: string }[] = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
];

function num(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function RecurringFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useFinanceStore((s) => (id ? s.getRecurring(id) : undefined));
  const addRecurring = useFinanceStore((s) => s.addRecurring);
  const updateRecurring = useFinanceStore((s) => s.updateRecurring);
  const lists = useFinanceStore((s) => s.lists);
  const reminderPrefs = useFinanceStore((s) => s.reminderPrefs);
  const [params] = useSearchParams();

  const [name, setName] = useState(existing?.name ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [count, setCount] = useState(existing ? String(existing.intervalCount) : '1');
  const [unit, setUnit] = useState<IntervalUnit>(existing?.intervalUnit ?? 'month');
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayISO());
  const [listId, setListId] = useState(existing?.listId ?? params.get('list') ?? '');
  const [notify, setNotify] = useState(existing?.notify ?? true);
  const [notifyLeads, setNotifyLeads] = useState<number[]>(
    existing?.notifyLeads ?? reminderPrefs.leads,
  );
  const [notifyTime, setNotifyTime] = useState(
    existing?.notifyTime ??
      `${String(reminderPrefs.hour).padStart(2, '0')}:${String(reminderPrefs.minute).padStart(2, '0')}`,
  );

  const c = Math.max(1, Math.round(num(count)) || 1);
  const preview = useMemo(() => {
    if (num(amount) <= 0) return null;
    return {
      monthly: monthlyEquivalent(num(amount), c, unit),
      next: computeRecurring({
        id: 'p',
        name,
        amount: num(amount),
        intervalCount: c,
        intervalUnit: unit,
        startDate: startDate || todayISO(),
        createdAt: 0,
        updatedAt: 0,
      }).nextDue,
    };
  }, [amount, c, unit, startDate, name]);

  const valid = name.trim().length > 0 && num(amount) > 0;

  const submit = () => {
    if (!valid) return;
    const draft: RecurringDraft = {
      name: name.trim(),
      amount: num(amount),
      intervalCount: c,
      intervalUnit: unit,
      startDate: startDate || todayISO(),
      paused: existing?.paused ?? false,
      listId: listId || undefined,
      notify,
      notifyLeads,
      notifyTime,
    };
    if (existing) updateRecurring(existing.id, draft);
    else addRecurring(draft);
    notifySuccess();
    navigate(-1);
  };

  return (
    <Screen title={existing ? 'Изменить платёж' : 'Регулярный платёж'}>
      <div className="field">
        <label className="field__label">Название</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Напр. Аренда квартиры"
        />
      </div>

      <div className="field">
        <label className="field__label">Сумма</label>
        <input
          className="input"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="30000"
        />
      </div>

      <div className="field">
        <label className="field__label">Период</label>
        <div className="segmented">
          {UNITS.map((u) => (
            <button
              key={u.value}
              className={`segmented__opt${unit === u.value ? ' is-active' : ''}`}
              onClick={() => {
                selectionChanged();
                setUnit(u.value);
              }}
            >
              {u.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 10, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 14 }}>
            Каждые
          </span>
          <input
            className="input"
            style={{ width: 90 }}
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
          <span className="muted" style={{ fontSize: 14, flex: 1 }}>
            {intervalLabel(c, unit).toLowerCase()}
          </span>
        </div>
      </div>

      <div className="field">
        <label className="field__label">Начало (с какого числа)</label>
        <input
          className="input"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>

      {preview && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="stat-row">
            <span className="stat-row__label">Цикл</span>
            <span className="stat-row__value">{intervalLabel(c, unit)}</span>
          </div>
          <div className="stat-row">
            <span className="stat-row__label">В пересчёте на месяц</span>
            <span className="stat-row__value">≈ {formatRUB(Math.round(preview.monthly))}</span>
          </div>
          <div className="stat-row">
            <span className="stat-row__label">Ближайшее списание</span>
            <span className="stat-row__value">{formatDate(preview.next)}</span>
          </div>
        </div>
      )}

      {lists.length > 0 && (
        <div className="field">
          <label className="field__label">Список</label>
          <select className="select" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Без списка</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {(l.emoji ? `${l.emoji} ` : '') + l.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <label className="toggle-row">
        <span>🔔 Напоминать о платеже</span>
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
      </label>

      {notify && (
        <div className="field">
          <label className="field__label">Когда напоминать (перед каждым списанием)</label>
          <LeadPicker value={notifyLeads} onChange={setNotifyLeads} />
          <label className="field__label" style={{ marginTop: 12 }}>
            Во сколько (МСК)
          </label>
          <input
            className="input"
            type="time"
            value={notifyTime}
            onChange={(e) => setNotifyTime(e.target.value)}
          />
        </div>
      )}

      <button className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        {existing ? 'Сохранить' : 'Добавить'}
      </button>
    </Screen>
  );
}
