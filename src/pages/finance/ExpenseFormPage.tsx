import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LeadPicker, Screen } from '@/components/ui';
import type { ExpenseType, Obligation } from '@/types';
import { useFinanceStore, type ObligationDraft } from '@/store';
import { computeObligation } from '@/lib/finance-calc';
import { parseISO, todayISO } from '@/lib/date';
import { formatRUB } from '@/lib/format';
import { notifySuccess, selectionChanged } from '@/lib/haptics';

const TYPES: { value: ExpenseType; label: string }[] = [
  { value: 'single', label: 'Разовый' },
  { value: 'credit', label: 'Кредит' },
  { value: 'installment', label: 'Рассрочка' },
];

// What the user knows about an installment plan.
type InstMode = 'monthly' | 'total' | 'body';
const INST_MODES: { value: InstMode; label: string }[] = [
  { value: 'monthly', label: 'Платёж/мес' },
  { value: 'total', label: 'Вся сумма' },
  { value: 'body', label: 'Тело' },
];

function num(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function ExpenseFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useFinanceStore((s) => (id ? s.getExpense(id) : undefined));
  const addExpense = useFinanceStore((s) => s.addExpense);
  const updateExpense = useFinanceStore((s) => s.updateExpense);
  const lists = useFinanceStore((s) => s.lists);
  const reminderPrefs = useFinanceStore((s) => s.reminderPrefs);
  const [params] = useSearchParams();

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<ExpenseType>(existing?.type ?? 'credit');
  const [principal, setPrincipal] = useState(existing ? String(existing.principalAmount) : '');
  const [monthly, setMonthly] = useState(existing?.monthlyPayment ? String(existing.monthlyPayment) : '');
  const [rate, setRate] = useState(existing?.interestRate ? String(existing.interestRate) : '');
  const [overpay, setOverpay] = useState(existing?.overpayment ? String(existing.overpayment) : '');
  const [total, setTotal] = useState(existing?.totalAmount ? String(existing.totalAmount) : '');
  const [instMode, setInstMode] = useState<InstMode>(
    existing?.type === 'installment'
      ? existing.totalAmount
        ? 'total'
        : existing.principalAmount
          ? 'body'
          : 'monthly'
      : 'monthly',
  );
  const [term, setTerm] = useState(existing ? String(existing.termMonths) : '12');
  const [day, setDay] = useState(existing ? String(existing.paymentDay) : '1');
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayISO());
  const [listId, setListId] = useState(existing?.listId ?? params.get('list') ?? '');
  const [notify, setNotify] = useState(existing?.notify ?? true);
  const [notifyLeads, setNotifyLeads] = useState<number[]>(existing?.notifyLeads ?? reminderPrefs.leads);
  const [notifyTime, setNotifyTime] = useState(
    existing?.notifyTime ??
      `${String(reminderPrefs.hour).padStart(2, '0')}:${String(reminderPrefs.minute).padStart(2, '0')}`,
  );

  const draft = useMemo<ObligationDraft>(() => {
    const start = startDate || todayISO();
    if (type === 'single') {
      return {
        name,
        type,
        principalAmount: num(principal),
        paymentDay: parseISO(start)?.getDate() ?? 1,
        termMonths: 1,
        startDate: start,
        listId: listId || undefined,
        notify,
        notifyLeads,
        notifyTime,
      };
    }
    const base: ObligationDraft = {
      name,
      type,
      principalAmount: num(principal),
      paymentDay: Math.min(31, Math.max(1, Math.round(num(day)) || 1)),
      termMonths: Math.max(1, Math.round(num(term)) || 1),
      startDate: start,
      listId: listId || undefined,
      notify,
      notifyLeads,
      notifyTime,
    };
    if (type === 'credit') {
      return {
        ...base,
        monthlyPayment: num(monthly) || undefined,
        interestRate: num(rate) || undefined,
      };
    }
    // installment — the user supplies ONE of: monthly payment, total amount, or
    // the body (тело). Optionally the body to also see the overpayment.
    return {
      ...base,
      principalAmount: instMode === 'body' ? num(principal) : num(principal) || 0,
      monthlyPayment: instMode === 'monthly' ? num(monthly) || undefined : undefined,
      totalAmount: instMode === 'total' ? num(total) || undefined : undefined,
      overpayment: instMode === 'body' ? num(overpay) || undefined : undefined,
    };
  }, [name, type, principal, monthly, rate, overpay, total, instMode, term, day, startDate, listId, notify, notifyLeads, notifyTime]);

  const preview = useMemo(() => {
    const o: Obligation = {
      ...draft,
      id: 'preview',
      status: 'active',
      payments: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const c = computeObligation(o);
    return c.totalToPay > 0 ? c : null;
  }, [draft]);

  const valid =
    name.trim().length > 0 &&
    (type === 'installment'
      ? instMode === 'monthly'
        ? num(monthly) > 0
        : instMode === 'total'
          ? num(total) > 0
          : num(principal) > 0
      : num(principal) > 0);

  const submit = () => {
    if (!valid) return;
    if (existing) updateExpense(existing.id, draft);
    else addExpense(draft);
    notifySuccess();
    navigate(-1);
  };

  return (
    <Screen title={existing ? 'Изменить расход' : 'Новый расход'}>
      <div className="field">
        <label className="field__label">Название</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Напр. Кредит на машину"
        />
      </div>

      <div className="field">
        <label className="field__label">Тип</label>
        <div className="segmented">
          {TYPES.map((t) => (
            <button
              key={t.value}
              className={`segmented__opt${type === t.value ? ' is-active' : ''}`}
              onClick={() => {
                selectionChanged();
                setType(t.value);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {type !== 'installment' && (
        <div className="field">
          <label className="field__label">
            {type === 'single' ? 'Сумма' : 'Сумма (тело долга)'}
          </label>
          <input
            className="input"
            inputMode="decimal"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            placeholder="100000"
          />
        </div>
      )}

      {type === 'credit' && (
        <>
          <div className="field">
            <label className="field__label">Платёж в месяц</label>
            <input
              className="input"
              inputMode="decimal"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              placeholder="9456"
            />
          </div>
          <div className="field">
            <label className="field__label">Ставка, % годовых (необязательно)</label>
            <input
              className="input"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="24"
            />
          </div>
        </>
      )}

      {type === 'installment' && (
        <>
          <div className="field">
            <label className="field__label">Что вы знаете?</label>
            <div className="segmented">
              {INST_MODES.map((m) => (
                <button
                  key={m.value}
                  className={`segmented__opt${instMode === m.value ? ' is-active' : ''}`}
                  onClick={() => {
                    selectionChanged();
                    setInstMode(m.value);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {instMode === 'monthly' && (
            <div className="field">
              <label className="field__label">Платёж в месяц</label>
              <input
                className="input"
                inputMode="decimal"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
                placeholder="напр. 9456"
              />
            </div>
          )}

          {instMode === 'total' && (
            <div className="field">
              <label className="field__label">Вся сумма (сколько отдадите всего)</label>
              <input
                className="input"
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="напр. 113472"
              />
            </div>
          )}

          {instMode === 'body' && (
            <>
              <div className="field">
                <label className="field__label">Тело рассрочки</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={principal}
                  onChange={(e) => setPrincipal(e.target.value)}
                  placeholder="100000"
                />
              </div>
              <div className="field">
                <label className="field__label">Переплата всего (необязательно)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={overpay}
                  onChange={(e) => setOverpay(e.target.value)}
                  placeholder="0 — если без переплаты"
                />
              </div>
            </>
          )}
          <p className="muted" style={{ marginTop: -8, marginBottom: 16, fontSize: 13 }}>
            Остальное посчитается само из срока.
          </p>
        </>
      )}

      {type !== 'single' && (
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="field__label">Срок, мес</label>
            <input
              className="input"
              inputMode="numeric"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="12"
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="field__label">День платежа</label>
            <input
              className="input"
              inputMode="numeric"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              placeholder="1"
            />
          </div>
        </div>
      )}

      <div className="field">
        <label className="field__label">{type === 'single' ? 'Дата' : 'Дата начала'}</label>
        <input
          className="input"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>

      {preview && type !== 'single' && (
        <div className="card" style={{ marginTop: 4, marginBottom: 18 }}>
          <div className="stat-row">
            <span className="stat-row__label">Итого к выплате</span>
            <span className="stat-row__value">{formatRUB(preview.totalToPay)}</span>
          </div>
          {preview.totalOverpayment > 0 && (
            <div className="stat-row">
              <span className="stat-row__label">Переплата</span>
              <span className="stat-row__value amount-neg">{formatRUB(preview.totalOverpayment)}</span>
            </div>
          )}
          <div className="stat-row">
            <span className="stat-row__label">Платёж в месяц</span>
            <span className="stat-row__value">{formatRUB(Math.round(preview.monthlyPayment))}</span>
          </div>
          {preview.derivedInterestRate != null && (
            <div className="stat-row">
              <span className="stat-row__label">Эффективная ставка</span>
              <span className="stat-row__value">≈ {preview.derivedInterestRate.toFixed(1)}% годовых</span>
            </div>
          )}
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
          <label className="field__label">Когда напоминать</label>
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
