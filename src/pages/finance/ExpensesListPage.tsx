import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ConfirmDialog, EmptyState, Fab, Screen, SwipeRow } from '@/components/ui';
import { IconPencil, IconTrash } from '@/components/icons';
import { ObligationMiniCard, RecurringMiniCard } from '@/components/finance-cards';
import { useFinanceStore } from '@/store';
import { notifyWarning, tapLight } from '@/lib/haptics';

type Tab = 'once' | 'recurring';
type Confirm = { kind: 'obligation' | 'recurring'; id: string; name: string };

export function ExpensesListPage() {
  const navigate = useNavigate();
  const expenses = useFinanceStore((s) => s.expenses);
  const recurring = useFinanceStore((s) => s.recurring);
  const lists = useFinanceStore((s) => s.lists);
  const removeExpense = useFinanceStore((s) => s.removeExpense);
  const removeRecurring = useFinanceStore((s) => s.removeRecurring);
  // Tab lives in the URL so it survives navigating to a form and back.
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'recurring' ? 'recurring' : 'once';
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const listName = (id?: string) => (id ? lists.find((l) => l.id === id)?.name : undefined);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  const switchTab = (t: Tab) => {
    if (t !== tab) {
      tapLight();
      setParams(t === 'recurring' ? { tab: 'recurring' } : {}, { replace: true });
    }
  };

  const doDelete = () => {
    if (!confirm) return;
    notifyWarning();
    if (confirm.kind === 'obligation') removeExpense(confirm.id);
    else removeRecurring(confirm.id);
    setConfirm(null);
  };

  return (
    <Screen title="Мои расходы">
      <div className="tabs">
        <button className={`tabs__tab${tab === 'once' ? ' is-active' : ''}`} onClick={() => switchTab('once')}>
          Платежи
        </button>
        <button
          className={`tabs__tab${tab === 'recurring' ? ' is-active' : ''}`}
          onClick={() => switchTab('recurring')}
        >
          Регулярные
        </button>
      </div>

      {tab === 'once' &&
        (expenses.length === 0 ? (
          <EmptyState
            icon="💸"
            title="Пока нет платежей"
            sub="Нажмите +, чтобы добавить кредит, рассрочку или разовый платёж"
          />
        ) : (
          <div className="stack">
            {expenses.map((o) => (
              <SwipeRow
                key={o.id}
                onTap={() => go(`/finance/expenses/${o.id}`)}
                actions={[
                  {
                    icon: <IconPencil size={19} />,
                    label: 'Изменить',
                    onClick: () => go(`/finance/expenses/${o.id}/edit`),
                  },
                  {
                    icon: <IconTrash size={19} />,
                    label: 'Удалить',
                    danger: true,
                    onClick: () => setConfirm({ kind: 'obligation', id: o.id, name: o.name }),
                  },
                ]}
              >
                <ObligationMiniCard o={o} tag={listName(o.listId)} onClick={() => {}} />
              </SwipeRow>
            ))}
          </div>
        ))}

      {tab === 'recurring' &&
        (recurring.length === 0 ? (
          <EmptyState
            icon="🔁"
            title="Пока нет регулярных"
            sub="Аренда, подписки, интернет — добавьте по кнопке +"
          />
        ) : (
          <div className="stack">
            {recurring.map((r) => (
              <SwipeRow
                key={r.id}
                onTap={() => go(`/finance/recurring/${r.id}`)}
                actions={[
                  {
                    icon: <IconPencil size={19} />,
                    label: 'Изменить',
                    onClick: () => go(`/finance/recurring/${r.id}/edit`),
                  },
                  {
                    icon: <IconTrash size={19} />,
                    label: 'Удалить',
                    danger: true,
                    onClick: () => setConfirm({ kind: 'recurring', id: r.id, name: r.name }),
                  },
                ]}
              >
                <RecurringMiniCard r={r} tag={listName(r.listId)} onClick={() => {}} />
              </SwipeRow>
            ))}
          </div>
        ))}

      <Fab onClick={() => go(tab === 'once' ? '/finance/expenses/new' : '/finance/recurring/new')} />

      {confirm && (
        <ConfirmDialog
          message={`Удалить «${confirm.name}»${confirm.kind === 'obligation' ? ' и все его платежи' : ''}?`}
          onConfirm={doDelete}
          onClose={() => setConfirm(null)}
        />
      )}
    </Screen>
  );
}
