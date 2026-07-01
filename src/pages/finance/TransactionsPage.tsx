import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog, EmptyState, Fab, Screen, StatTile, SwipeRow } from '@/components/ui';
import { IconChart, IconChevron, IconPencil, IconTrash } from '@/components/icons';
import type { Transaction } from '@/types';
import { useFinanceStore } from '@/store';
import { getCategory } from '@/lib/categories';
import { monthBounds } from '@/lib/analytics';
import { addMonths, parseISO, toISO, todayISO } from '@/lib/date';
import { formatDate, formatRUB } from '@/lib/format';
import { notifyWarning, tapLight } from '@/lib/haptics';

const monthTitleFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

export function TransactionsPage() {
  const navigate = useNavigate();
  const transactions = useFinanceStore((s) => s.transactions);
  const removeTransaction = useFinanceStore((s) => s.removeTransaction);
  const [anchor, setAnchor] = useState(todayISO());
  const [confirm, setConfirm] = useState<Transaction | null>(null);

  const { from, until } = monthBounds(anchor);
  const { rows, income, expense } = useMemo(() => {
    const rows = transactions
      .filter((t) => t.date >= from && t.date <= until)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    let income = 0;
    let expense = 0;
    for (const t of rows) {
      if (t.direction === 'income') income += t.amount;
      else expense += t.amount;
    }
    return { rows, income, expense };
  }, [transactions, from, until]);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };
  const shiftMonth = (delta: number) => {
    tapLight();
    setAnchor(toISO(addMonths(parseISO(anchor) ?? new Date(), delta, 1)));
  };

  const doDelete = () => {
    if (!confirm) return;
    notifyWarning();
    removeTransaction(confirm.id);
    setConfirm(null);
  };

  return (
    <Screen
      title="Траты и доходы"
      subtitle="Дневник"
      action={
        <button
          className="icon-round"
          onClick={() => go('/finance/analytics')}
          aria-label="Аналитика"
        >
          <IconChart size={20} />
        </button>
      }
    >
      <div className="month-nav">
        <button className="icon-round" onClick={() => shiftMonth(-1)} aria-label="Прошлый месяц">
          <IconChevron size={20} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <span className="month-nav__label">
          {monthTitleFmt.format(parseISO(anchor) ?? new Date())}
        </span>
        <button className="icon-round" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
          <IconChevron size={20} />
        </button>
      </div>

      <div className="card">
        <div className="stat-grid">
          <StatTile
            label="Доходы"
            value={<span className="amount-pos">{formatRUB(income)}</span>}
          />
          <StatTile label="Расходы" value={formatRUB(expense)} />
        </div>
        <div className="stat-row" style={{ marginTop: 4 }}>
          <span className="stat-row__label">Остаток за месяц</span>
          <span
            className={`stat-row__value ${income - expense >= 0 ? 'amount-pos' : 'amount-neg'}`}
          >
            {income - expense >= 0 ? '+' : '−'}
            {formatRUB(Math.abs(income - expense))}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="Пусто в этом месяце"
          sub="Нажмите +, чтобы записать трату или доход"
        />
      ) : (
        <div className="stack" style={{ marginTop: 4 }}>
          {rows.map((t) => {
            const c = getCategory(t.category, t.direction);
            const income = t.direction === 'income';
            return (
              <SwipeRow
                key={t.id}
                onTap={() => go(`/finance/transactions/${t.id}/edit`)}
                actions={[
                  {
                    icon: <IconPencil size={19} />,
                    label: 'Изменить',
                    onClick: () => go(`/finance/transactions/${t.id}/edit`),
                  },
                  {
                    icon: <IconTrash size={19} />,
                    label: 'Удалить',
                    danger: true,
                    onClick: () => setConfirm(t),
                  },
                ]}
              >
                <div className="tx-row">
                  <span className="tx-row__icon" style={{ background: `${c.color}22` }}>
                    {c.emoji}
                  </span>
                  <div className="tx-row__body">
                    <div className="tx-row__title">{t.note || c.label}</div>
                    <div className="tx-row__sub">
                      {c.label} · {formatDate(t.date, true)}
                    </div>
                  </div>
                  <span className={`tx-row__amount ${income ? 'amount-pos' : ''}`}>
                    {income ? '+' : '−'}
                    {formatRUB(t.amount)}
                  </span>
                </div>
              </SwipeRow>
            );
          })}
        </div>
      )}

      <Fab onClick={() => go('/finance/transactions/new')} />

      {confirm && (
        <ConfirmDialog
          message={`Удалить запись на ${formatRUB(confirm.amount)}?`}
          onConfirm={doDelete}
          onClose={() => setConfirm(null)}
        />
      )}
    </Screen>
  );
}
