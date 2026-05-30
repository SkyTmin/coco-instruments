import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, SectionCard, StatTile } from '@/components/ui';
import { IconTarget, IconWallet } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { computeObligation } from '@/lib/finance-calc';
import { ObligationsBreakdownChart } from '@/charts';
import { formatDate, formatRUB } from '@/lib/format';
import { tapLight } from '@/lib/haptics';

export function FinanceDashboardPage() {
  const navigate = useNavigate();
  const expenses = useFinanceStore((s) => s.expenses);
  const savings = useFinanceStore((s) => s.savings);

  const { monthlyTotal, totalRemaining, active, next } = useMemo(() => {
    const active = expenses.filter((o) => o.status !== 'closed');
    let monthlyTotal = 0;
    let totalRemaining = 0;
    const upcoming: { name: string; date: string; amount: number }[] = [];
    for (const o of active) {
      const c = computeObligation(o);
      monthlyTotal += c.monthlyPayment;
      totalRemaining += c.remaining;
      if (c.nextPaymentDate) {
        upcoming.push({ name: o.name, date: c.nextPaymentDate, amount: c.monthlyPayment });
      }
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
    return { monthlyTotal, totalRemaining, active, next: upcoming[0] };
  }, [expenses]);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  return (
    <Screen title="Финансы" subtitle="Обзор">
      <div className="stack">
        <div className="card">
          <div className="stat-grid">
            <StatTile label="Платежей в месяц" value={formatRUB(monthlyTotal)} />
            <StatTile label="Осталось выплатить" value={formatRUB(totalRemaining)} />
          </div>
        </div>

        {next && (
          <div className="next-pay">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, opacity: 0.9 }}>Ближайший платёж · {next.name}</div>
              <div className="next-pay__big">{formatRUB(next.amount)}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 13 }}>{formatDate(next.date, true)}</div>
          </div>
        )}

        <div className="section-label">Разделы</div>
        <SectionCard
          icon={<IconWallet />}
          title="Мои расходы"
          sub={expenses.length ? `${expenses.length} • активных: ${active.length}` : 'Кредиты, рассрочки, платежи'}
          onClick={() => go('/finance/expenses')}
        />
        <SectionCard
          icon={<IconTarget />}
          title="Накопления"
          sub={savings.length ? `${savings.length} цел${savings.length === 1 ? 'ь' : 'и'}` : 'Цели и прогресс'}
          onClick={() => go('/finance/savings')}
        />

        {active.length > 0 && (
          <div className="chart-card">
            <div className="chart-card__title">Платежи в месяц</div>
            <ObligationsBreakdownChart obligations={active} />
          </div>
        )}
      </div>
    </Screen>
  );
}
