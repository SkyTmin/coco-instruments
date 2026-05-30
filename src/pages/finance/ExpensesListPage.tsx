import { useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState, Fab, Screen } from '@/components/ui';
import { ObligationMiniCard, RecurringMiniCard } from '@/components/finance-cards';
import { useFinanceStore } from '@/store';
import { tapLight } from '@/lib/haptics';

type Tab = 'once' | 'recurring';

export function ExpensesListPage() {
  const navigate = useNavigate();
  const expenses = useFinanceStore((s) => s.expenses);
  const recurring = useFinanceStore((s) => s.recurring);
  const lists = useFinanceStore((s) => s.lists);
  // Tab lives in the URL so it survives navigating to a form and back.
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'recurring' ? 'recurring' : 'once';

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
              <ObligationMiniCard
                key={o.id}
                o={o}
                tag={listName(o.listId)}
                onClick={() => go(`/finance/expenses/${o.id}`)}
              />
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
              <RecurringMiniCard
                key={r.id}
                r={r}
                tag={listName(r.listId)}
                onClick={() => go(`/finance/recurring/${r.id}`)}
              />
            ))}
          </div>
        ))}

      <Fab onClick={() => go(tab === 'once' ? '/finance/expenses/new' : '/finance/recurring/new')} />
    </Screen>
  );
}
