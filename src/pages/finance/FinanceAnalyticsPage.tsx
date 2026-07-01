import { useMemo, useState } from 'react';
import { EmptyState, Screen, StatTile } from '@/components/ui';
import { IconChevron } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { cashflowByMonth, monthBounds, monthlyForecast, spendByCategory } from '@/lib/analytics';
import { addMonths, parseISO, toISO, todayISO } from '@/lib/date';
import { formatRUB } from '@/lib/format';
import { tapLight } from '@/lib/haptics';

const monthTitleFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const monthShortFmt = new Intl.DateTimeFormat('ru-RU', { month: 'short' });

export function FinanceAnalyticsPage() {
  const transactions = useFinanceStore((s) => s.transactions);
  const incomeSources = useFinanceStore((s) => s.incomeSources);
  const expenses = useFinanceStore((s) => s.expenses);
  const recurring = useFinanceStore((s) => s.recurring);
  const [anchor, setAnchor] = useState(todayISO());

  const { from, until } = monthBounds(anchor);
  const slices = useMemo(
    () => spendByCategory(transactions, from, until),
    [transactions, from, until],
  );
  const months = useMemo(() => cashflowByMonth(transactions, 6, anchor), [transactions, anchor]);
  const forecast = useMemo(
    () => monthlyForecast(incomeSources, expenses, recurring, anchor),
    [incomeSources, expenses, recurring, anchor],
  );

  const totalSpent = slices.reduce((sum, s) => sum + s.amount, 0);
  const maxMonth = Math.max(...months.map((m) => Math.max(m.income, m.expense)), 1);

  const shiftMonth = (delta: number) => {
    tapLight();
    setAnchor(toISO(addMonths(parseISO(anchor) ?? new Date(), delta, 1)));
  };

  return (
    <Screen title="Аналитика" subtitle="Куда уходят деньги">
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
            label="Доход (прогноз)"
            value={<span className="amount-pos">{formatRUB(forecast.income)}</span>}
          />
          <StatTile label="Обязательные платежи" value={formatRUB(forecast.outgoings)} />
        </div>
        <div className="stat-row" style={{ marginTop: 4 }}>
          <span className="stat-row__label">Свободно после платежей</span>
          <span className={`stat-row__value ${forecast.free >= 0 ? 'amount-pos' : 'amount-neg'}`}>
            {forecast.free >= 0 ? '+' : '−'}
            {formatRUB(Math.abs(forecast.free))}
          </span>
        </div>
        <p className="muted" style={{ margin: '8px 2px 0', fontSize: 12 }}>
          Доход из источников минус запланированные платежи по кредитам и подпискам.
        </p>
      </div>

      <div className="section-label">Расходы по категориям</div>
      {slices.length === 0 ? (
        <EmptyState
          icon="📊"
          title="Нет трат в этом месяце"
          sub="Записи из дневника попадут сюда"
        />
      ) : (
        <div className="card">
          <p className="muted bar-caption">Всего потрачено: {formatRUB(totalSpent)}</p>
          <div className="stack" style={{ gap: 14 }}>
            {slices.map((s) => (
              <div key={s.category} className="bar-row">
                <div className="bar-row__head">
                  <span className="bar-row__name">
                    {s.emoji} {s.label}
                  </span>
                  <span className="bar-row__val">
                    {formatRUB(s.amount)} <i>· {Math.round(s.percent)}%</i>
                  </span>
                </div>
                <div className="progress">
                  <div
                    className="progress__fill"
                    style={{ width: `${Math.max(s.percent, 2)}%`, background: s.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section-label">Доход и расход по месяцам</div>
      <div className="card">
        <div className="cashflow-legend">
          <span>
            <i className="dot dot--in" /> Доход
          </span>
          <span>
            <i className="dot dot--out" /> Расход
          </span>
        </div>
        <div className="cashflow">
          {months.map((m) => {
            const d = parseISO(`${m.month}-01`) ?? new Date();
            return (
              <div key={m.month} className="cashflow__col">
                <span className="cashflow__bars">
                  <span
                    className="cashflow__bar cashflow__bar--in"
                    style={{ height: `${(m.income / maxMonth) * 100}%` }}
                  />
                  <span
                    className="cashflow__bar cashflow__bar--out"
                    style={{ height: `${(m.expense / maxMonth) * 100}%` }}
                  />
                </span>
                <span className="cashflow__lbl">{monthShortFmt.format(d).replace('.', '')}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}
