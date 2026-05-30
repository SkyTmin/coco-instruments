import { useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState, Fab, ProgressBar, Screen, TypeBadge } from '@/components/ui';
import { useFinanceStore } from '@/store';
import { computeObligation, computeRecurring } from '@/lib/finance-calc';
import type { Obligation, RecurringPayment } from '@/types';
import { formatDate, formatRUB, intervalLabel } from '@/lib/format';
import { tapLight } from '@/lib/haptics';

type Tab = 'once' | 'recurring';

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
        <span className="obl-card__remain">{closed ? 'Выплачено' : formatRUB(c.remaining)}</span>
        <span className="obl-card__total">из {formatRUB(c.totalToPay)}</span>
      </div>
      <ProgressBar percent={c.progressPercent} />
    </div>
  );
}

function RecurringCard({ r, onClick }: { r: RecurringPayment; onClick: () => void }) {
  const c = computeRecurring(r);
  return (
    <div className="obl-card" onClick={onClick} role="button">
      <div className="obl-card__top">
        <span className="obl-card__name">{r.name}</span>
        {r.paused ? (
          <span className="badge badge--closed">Пауза</span>
        ) : (
          <span className="badge badge--installment">{intervalLabel(r.intervalCount, r.intervalUnit)}</span>
        )}
      </div>
      <div className="obl-card__nums">
        <span className="obl-card__remain">{formatRUB(r.amount)}</span>
        <span className="obl-card__total">
          {r.paused ? 'на паузе' : `далее ${formatDate(c.nextDue, true)}`}
        </span>
      </div>
      <div className="rec-card__hint">≈ {formatRUB(Math.round(c.monthlyEquivalent))} в месяц</div>
    </div>
  );
}

export function ExpensesListPage() {
  const navigate = useNavigate();
  const expenses = useFinanceStore((s) => s.expenses);
  const recurring = useFinanceStore((s) => s.recurring);
  // Tab lives in the URL so it survives navigating to a form and back.
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'recurring' ? 'recurring' : 'once';

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
              <ObligationCard key={o.id} o={o} onClick={() => go(`/finance/expenses/${o.id}`)} />
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
              <RecurringCard key={r.id} r={r} onClick={() => go(`/finance/recurring/${r.id}`)} />
            ))}
          </div>
        ))}

      <Fab onClick={() => go(tab === 'once' ? '/finance/expenses/new' : '/finance/recurring/new')} />
    </Screen>
  );
}
