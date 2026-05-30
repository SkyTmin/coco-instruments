import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog, Screen, StatTile } from '@/components/ui';
import { IconCalendar, IconPencil, IconTrash } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { computeRecurring } from '@/lib/finance-calc';
import { formatDate, formatRUB, intervalLabel } from '@/lib/format';
import { notifyWarning, tapLight } from '@/lib/haptics';

export function RecurringDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const item = useFinanceStore((s) => (id ? s.getRecurring(id) : undefined));
  const updateRecurring = useFinanceStore((s) => s.updateRecurring);
  const removeRecurring = useFinanceStore((s) => s.removeRecurring);
  const [confirmDel, setConfirmDel] = useState(false);

  if (!item || !id) return <Navigate to="/finance/expenses" replace />;
  const c = computeRecurring(item);

  return (
    <Screen
      title={item.name}
      action={
        item.paused ? (
          <span className="badge badge--closed">Пауза</span>
        ) : (
          <span className="badge badge--installment">{intervalLabel(item.intervalCount, item.intervalUnit)}</span>
        )
      }
    >
      <div className="stack">
        {!item.paused && (
          <div className="next-pay">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, opacity: 0.9 }}>Ближайшее списание</div>
              <div className="next-pay__big">{formatRUB(item.amount)}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 13 }}>{formatDate(c.nextDue, true)}</div>
          </div>
        )}

        <div className="card">
          <div className="stat-grid">
            <StatTile label="Сумма" value={formatRUB(item.amount)} />
            <StatTile label="В месяц ≈" value={formatRUB(Math.round(c.monthlyEquivalent))} />
            <StatTile label="Цикл" value={intervalLabel(item.intervalCount, item.intervalUnit)} />
            <StatTile label="Начало" value={formatDate(item.startDate, true)} />
          </div>
        </div>

        {!item.paused && (
          <div className="card">
            <div className="chart-card__title" style={{ marginLeft: 0 }}>Ближайшие списания</div>
            {c.upcoming.map((d, i) => (
              <div key={i} className="pay-row">
                <IconCalendar size={18} className="chev" />
                <div style={{ flex: 1 }}>
                  <div className="pay-row__amount">{formatRUB(item.amount)}</div>
                  <div className="pay-row__date">{formatDate(d)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          className="btn btn--block"
          onClick={() => {
            updateRecurring(id, { paused: !item.paused });
            tapLight();
          }}
        >
          {item.paused ? 'Возобновить' : 'Поставить на паузу'}
        </button>

        <div className="row" style={{ gap: 12 }}>
          <button
            className="btn btn--block"
            style={{ flex: 1 }}
            onClick={() => {
              tapLight();
              navigate(`/finance/recurring/${id}/edit`);
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

      {confirmDel && (
        <ConfirmDialog
          message={`Удалить регулярный платёж «${item.name}»?`}
          onConfirm={() => {
            removeRecurring(id);
            notifyWarning();
            navigate('/finance/expenses', { replace: true });
          }}
          onClose={() => setConfirmDel(false)}
        />
      )}
    </Screen>
  );
}
