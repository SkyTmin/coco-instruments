import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  ConfirmDialog,
  ProgressBar,
  Screen,
  Sheet,
  StatTile,
  TypeBadge,
} from '@/components/ui';
import { IconPencil, IconTrash } from '@/components/icons';
import { CumulativePaidChart, PrincipalVsOverpaymentChart } from '@/charts';
import { useFinanceStore } from '@/store';
import { computeObligation } from '@/lib/finance-calc';
import type { Payment } from '@/types';
import { todayISO } from '@/lib/date';
import { formatDate, formatRUB, monthsLabel } from '@/lib/format';
import { notifySuccess, notifyWarning, tapLight } from '@/lib/haptics';

function num(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function PaymentSheet({
  payment,
  onClose,
  onSave,
  onDelete,
}: {
  payment?: Payment;
  onClose: () => void;
  onSave: (data: Omit<Payment, 'id'>) => void;
  onDelete?: () => void;
}) {
  const [amount, setAmount] = useState(payment ? String(payment.amount) : '');
  const [date, setDate] = useState(payment?.date || todayISO());
  const [note, setNote] = useState(payment?.note ?? '');
  const [prelim, setPrelim] = useState(payment?.isPreliminary ?? false);
  const valid = num(amount) > 0;

  return (
    <Sheet title={payment ? 'Платёж' : 'Новый платёж'} onClose={onClose}>
      <div className="field">
        <label className="field__label">Сумма</label>
        <input
          className="input"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
        />
      </div>
      <div className="field">
        <label className="field__label">Дата</label>
        <input
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={prelim}
        />
      </div>
      <label className="row" style={{ gap: 8, marginBottom: 16 }}>
        <input type="checkbox" checked={prelim} onChange={(e) => setPrelim(e.target.checked)} />
        <span className="muted">Предварительный (не учитывать в выплаченном)</span>
      </label>
      <div className="stack">
        <button
          className="btn btn--primary btn--block"
          disabled={!valid}
          onClick={() =>
            onSave({ amount: num(amount), date: prelim ? '' : date, note, isPreliminary: prelim })
          }
        >
          Сохранить
        </button>
        {onDelete && (
          <button className="btn btn--danger btn--block" onClick={onDelete}>
            Удалить платёж
          </button>
        )}
      </div>
    </Sheet>
  );
}

export function ExpenseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const obligation = useFinanceStore((s) => (id ? s.getExpense(id) : undefined));
  const addPayment = useFinanceStore((s) => s.addPayment);
  const updatePayment = useFinanceStore((s) => s.updatePayment);
  const removePayment = useFinanceStore((s) => s.removePayment);
  const removeExpense = useFinanceStore((s) => s.removeExpense);
  const updateExpense = useFinanceStore((s) => s.updateExpense);

  const [sheet, setSheet] = useState<{ mode: 'add' } | { mode: 'edit'; payment: Payment } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  if (!obligation || !id) return <Navigate to="/finance/expenses" replace />;
  const c = computeObligation(obligation);
  const closed = obligation.status === 'closed';
  const payments = [...obligation.payments].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return (
    <Screen
      title={obligation.name}
      action={
        closed ? <span className="badge badge--closed">Завершён</span> : <TypeBadge type={obligation.type} />
      }
    >
      <div className="stack">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <span className="muted" style={{ fontSize: 13 }}>Прогресс выплаты</span>
            <span style={{ fontWeight: 800 }}>{c.progressPercent}%</span>
          </div>
          <ProgressBar percent={c.progressPercent} large />
          <div className="stat-grid" style={{ marginTop: 14 }}>
            <StatTile label="Осталось" value={formatRUB(c.remaining)} />
            <StatTile label="Выплачено" value={formatRUB(c.paidSoFar)} />
            <StatTile label="Итого к выплате" value={formatRUB(c.totalToPay)} />
            <StatTile label="Переплата" value={formatRUB(c.totalOverpayment)} />
          </div>
        </div>

        {obligation.type !== 'single' && (
          <div className="card">
            <div className="stat-row">
              <span className="stat-row__label">Платёж в месяц</span>
              <span className="stat-row__value">{formatRUB(Math.round(c.monthlyPayment))}</span>
            </div>
            <div className="stat-row">
              <span className="stat-row__label">Срок</span>
              <span className="stat-row__value">
                {monthsLabel(obligation.termMonths)} · осталось {c.monthsRemaining}
              </span>
            </div>
            {c.nextPaymentDate && (
              <div className="stat-row">
                <span className="stat-row__label">Следующий платёж</span>
                <span className="stat-row__value">{formatDate(c.nextPaymentDate)}</span>
              </div>
            )}
            {c.derivedInterestRate != null && (
              <div className="stat-row">
                <span className="stat-row__label">Эффективная ставка</span>
                <span className="stat-row__value">≈ {c.derivedInterestRate.toFixed(1)}% годовых</span>
              </div>
            )}
          </div>
        )}

        {c.totalOverpayment > 0 && (
          <div className="chart-card">
            <div className="chart-card__title">Структура</div>
            <PrincipalVsOverpaymentChart obligation={obligation} />
          </div>
        )}

        {obligation.type !== 'single' && (
          <div className="chart-card">
            <div className="chart-card__title">Выплаты по месяцам</div>
            <CumulativePaidChart schedule={c.schedule} />
          </div>
        )}

        <div className="section-label">Платежи</div>
        <div className="card">
          {payments.length === 0 ? (
            <div className="muted center" style={{ padding: '8px 0' }}>Платежей пока нет</div>
          ) : (
            payments.map((p) => (
              <div
                key={p.id}
                className="pay-row"
                onClick={() => {
                  tapLight();
                  setSheet({ mode: 'edit', payment: p });
                }}
                role="button"
              >
                <div style={{ flex: 1 }}>
                  <div className="pay-row__amount">
                    {formatRUB(p.amount)} {p.isPreliminary && <span className="badge">предв.</span>}
                  </div>
                  <div className="pay-row__date">
                    {p.isPreliminary ? 'Без даты' : formatDate(p.date)}
                    {p.note ? ` · ${p.note}` : ''}
                  </div>
                </div>
                <IconPencil className="chev" size={18} />
              </div>
            ))
          )}
          <button
            className="btn btn--ghost btn--block"
            style={{ marginTop: 8 }}
            onClick={() => {
              tapLight();
              setSheet({ mode: 'add' });
            }}
          >
            + Добавить платёж
          </button>
        </div>

        {obligation.manuallyClosed ? (
          <button
            className="btn btn--block"
            onClick={() => {
              updateExpense(id, { manuallyClosed: false });
              tapLight();
            }}
          >
            Возобновить счёт
          </button>
        ) : (
          obligation.status !== 'closed' && (
            <button
              className="btn btn--block"
              onClick={() => {
                updateExpense(id, { manuallyClosed: true });
                notifySuccess();
              }}
            >
              Завершить счёт
            </button>
          )
        )}

        <div className="row" style={{ gap: 12, marginTop: 8 }}>
          <button
            className="btn btn--block"
            style={{ flex: 1 }}
            onClick={() => {
              tapLight();
              navigate(`/finance/expenses/${id}/edit`);
            }}
          >
            <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <IconPencil size={18} /> Изменить
            </span>
          </button>
          <button className="btn btn--danger" onClick={() => setConfirmDel(true)} aria-label="Удалить">
            <IconTrash size={18} />
          </button>
        </div>
      </div>

      {sheet && (
        <PaymentSheet
          payment={sheet.mode === 'edit' ? sheet.payment : undefined}
          onClose={() => setSheet(null)}
          onSave={(data) => {
            if (sheet.mode === 'edit') updatePayment(id, sheet.payment.id, data);
            else addPayment(id, data);
            notifySuccess();
            setSheet(null);
          }}
          onDelete={
            sheet.mode === 'edit'
              ? () => {
                  removePayment(id, sheet.payment.id);
                  notifyWarning();
                  setSheet(null);
                }
              : undefined
          }
        />
      )}

      {confirmDel && (
        <ConfirmDialog
          message={`Удалить «${obligation.name}» и все его платежи?`}
          onConfirm={() => {
            removeExpense(id);
            notifyWarning();
            navigate('/finance/expenses', { replace: true });
          }}
          onClose={() => setConfirmDel(false)}
        />
      )}
    </Screen>
  );
}
