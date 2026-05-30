import { useNavigate } from 'react-router-dom';
import { EmptyState, Fab, ProgressBar, Screen, TypeBadge } from '@/components/ui';
import { useFinanceStore } from '@/store';
import { computeObligation } from '@/lib/finance-calc';
import type { Obligation } from '@/types';
import { formatRUB } from '@/lib/format';
import { tapLight } from '@/lib/haptics';

function ObligationCard({ o, onClick }: { o: Obligation; onClick: () => void }) {
  const c = computeObligation(o);
  const closed = o.status === 'closed';
  return (
    <div className="obl-card" onClick={onClick} role="button">
      <div className="obl-card__top">
        <span className="obl-card__name">{o.name}</span>
        {closed ? <span className="badge badge--closed">Закрыт</span> : <TypeBadge type={o.type} />}
      </div>
      <div className="obl-card__nums">
        <span className="obl-card__remain">
          {closed ? 'Выплачено' : formatRUB(c.remaining)}
        </span>
        <span className="obl-card__total">из {formatRUB(c.totalToPay)}</span>
      </div>
      <ProgressBar percent={c.progressPercent} />
    </div>
  );
}

export function ExpensesListPage() {
  const navigate = useNavigate();
  const expenses = useFinanceStore((s) => s.expenses);

  return (
    <Screen title="Мои расходы">
      {expenses.length === 0 ? (
        <EmptyState
          icon="💸"
          title="Пока нет расходов"
          sub="Нажмите +, чтобы добавить кредит, рассрочку или разовый платёж"
        />
      ) : (
        <div className="stack">
          {expenses.map((o) => (
            <ObligationCard
              key={o.id}
              o={o}
              onClick={() => {
                tapLight();
                navigate(`/finance/expenses/${o.id}`);
              }}
            />
          ))}
        </div>
      )}
      <Fab
        onClick={() => {
          tapLight();
          navigate('/finance/expenses/new');
        }}
      />
    </Screen>
  );
}
