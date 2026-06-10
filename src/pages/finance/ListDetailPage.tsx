import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  ConfirmDialog,
  EmptyState,
  Fab,
  Screen,
  SectionHeader,
  Sheet,
  StatTile,
} from '@/components/ui';
import { IconPencil, IconTrash } from '@/components/icons';
import { ObligationMiniCard, RecurringMiniCard } from '@/components/finance-cards';
import { useFinanceStore } from '@/store';
import { computeObligation, computeRecurring, paidSoFar } from '@/lib/finance-calc';
import { formatRUB } from '@/lib/format';
import { notifyWarning, tapLight } from '@/lib/haptics';

export function ListDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const list = useFinanceStore((s) => (id ? s.getList(id) : undefined));
  const expenses = useFinanceStore((s) => s.expenses);
  const recurring = useFinanceStore((s) => s.recurring);
  const removeList = useFinanceStore((s) => s.removeList);
  const [confirmDel, setConfirmDel] = useState(false);
  const [adding, setAdding] = useState(false);

  if (!list || !id) return <Navigate to="/finance/lists" replace />;

  const obls = expenses.filter((o) => o.listId === id);
  const recs = recurring.filter((r) => r.listId === id);
  let totalNeeded = 0; // sum of every obligation's full cost (paid + unpaid)
  let remaining = 0;
  let monthly = 0;
  let spent = 0;
  for (const o of obls) {
    const c = computeObligation(o);
    totalNeeded += c.totalToPay; // counts closed credits too
    spent += paidSoFar(o.payments);
    if (o.status !== 'closed') {
      remaining += c.remaining;
      monthly += c.monthlyPayment;
    }
  }
  for (const r of recs) {
    if (!r.paused) monthly += computeRecurring(r).monthlyEquivalent;
  }

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };
  const empty = obls.length === 0 && recs.length === 0;

  return (
    <Screen title={`${list.emoji || '📂'} ${list.name}`}>
      <div className="stack">
        <div className="card">
          <div className="stat-grid">
            <StatTile label="Всего" value={formatRUB(totalNeeded)} />
            <StatTile label="Потрачено" value={formatRUB(spent)} />
            <StatTile label="Осталось" value={formatRUB(remaining)} />
            <StatTile label="В месяц" value={formatRUB(monthly)} />
          </div>
        </div>

        {empty ? (
          <EmptyState
            icon="📂"
            title="В списке пока пусто"
            sub="Добавьте сюда платёж или регулярный расход по кнопке +"
          />
        ) : (
          <>
            <SectionHeader
              title="Платежи списка"
              action={
                <button className="link-all" onClick={() => go(`/finance/calendar?list=${id}`)}>
                  Все ›
                </button>
              }
            />
            {obls.map((o) => (
              <ObligationMiniCard
                key={o.id}
                o={o}
                onClick={() => go(`/finance/expenses/${o.id}`)}
              />
            ))}
            {recs.map((r) => (
              <RecurringMiniCard
                key={r.id}
                r={r}
                onClick={() => go(`/finance/recurring/${r.id}`)}
              />
            ))}
          </>
        )}

        <div className="row" style={{ gap: 12, marginTop: 8 }}>
          <button
            className="btn btn--block"
            style={{ flex: 1 }}
            onClick={() => go(`/finance/lists/${id}/edit`)}
          >
            <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <IconPencil size={18} /> Изменить
            </span>
          </button>
          <button
            className="btn btn--danger"
            onClick={() => setConfirmDel(true)}
            aria-label="Удалить"
          >
            <IconTrash size={18} />
          </button>
        </div>
      </div>

      <Fab
        onClick={() => {
          tapLight();
          setAdding(true);
        }}
      />

      {adding && (
        <Sheet title="Добавить в список" onClose={() => setAdding(false)}>
          <div className="stack">
            <button
              className="btn btn--primary btn--block"
              onClick={() => go(`/finance/expenses/new?list=${id}`)}
            >
              Платёж / кредит / рассрочка
            </button>
            <button
              className="btn btn--block"
              onClick={() => go(`/finance/recurring/new?list=${id}`)}
            >
              Регулярный платёж
            </button>
            <button className="btn btn--ghost btn--block" onClick={() => setAdding(false)}>
              Отмена
            </button>
          </div>
        </Sheet>
      )}

      {confirmDel && (
        <ConfirmDialog
          message={`Удалить список «${list.name}»? Платежи останутся, но без списка.`}
          onConfirm={() => {
            removeList(id);
            notifyWarning();
            navigate('/finance/lists', { replace: true });
          }}
          onClose={() => setConfirmDel(false)}
        />
      )}
    </Screen>
  );
}
