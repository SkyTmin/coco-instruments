import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AnimatedNumber,
  ProgressRing,
  Screen,
  SectionCard,
  SectionHeader,
  Sheet,
  Skeleton,
  StatTile,
} from '@/components/ui';
import {
  IconBell,
  IconCalendar,
  IconChart,
  IconList,
  IconTarget,
  IconWallet,
} from '@/components/icons';
import { useFinanceStore } from '@/store';
import { collectPayments, computeObligation, computeRecurring } from '@/lib/finance-calc';
import { totalMonthlyIncome } from '@/lib/income';
import { parseISO, toISO, todayISO } from '@/lib/date';
import { formatDate, formatRUB } from '@/lib/format';
import { tapLight } from '@/lib/haptics';

const monthShortFmt = new Intl.DateTimeFormat('ru-RU', { month: 'short' });

type Kind = 'obligation' | 'recurring';
type Tag = 'single' | 'credit' | 'installment' | 'recurring';
interface FlowItem {
  kind: Kind;
  id: string;
  name: string;
  value: number;
}
interface UpItem extends FlowItem {
  date: string;
  amount: number;
  tag: Tag;
}

const TAG_META: Record<Tag, { label: string; cls: string }> = {
  single: { label: 'Разовый', cls: 'badge--single' },
  credit: { label: 'Кредит', cls: 'badge--credit' },
  installment: { label: 'Рассрочка', cls: 'badge--installment' },
  recurring: { label: 'Регулярный', cls: 'badge--recurring' },
};

const pathFor = (kind: Kind, id: string) =>
  kind === 'recurring' ? `/finance/recurring/${id}` : `/finance/expenses/${id}`;

function listsWord(n: number): string {
  const n1 = n % 10;
  const n2 = n % 100;
  if (n1 === 1 && n2 !== 11) return 'список';
  if (n1 >= 2 && n1 <= 4 && (n2 < 10 || n2 >= 20)) return 'списка';
  return 'списков';
}

/** Tappable name → amount rows used inside the stat-tile sheets. */
function FlowList({ items, onPick }: { items: FlowItem[]; onPick: (it: FlowItem) => void }) {
  return (
    <div className="sheet-list">
      {items.map((it) => (
        <button key={it.kind + it.id} className="flow-row" onClick={() => onPick(it)}>
          <span className="flow-row__name">{it.name}</span>
          <span className="flow-row__amount">{formatRUB(it.value)}</span>
        </button>
      ))}
    </div>
  );
}

export function FinanceDashboardPage() {
  const navigate = useNavigate();
  const expenses = useFinanceStore((s) => s.expenses);
  const savings = useFinanceStore((s) => s.savings);
  const recurring = useFinanceStore((s) => s.recurring);
  const lists = useFinanceStore((s) => s.lists);
  const incomeSources = useFinanceStore((s) => s.incomeSources);
  const hydrated = useFinanceStore((s) => s.hydrated);
  const [sheet, setSheet] = useState<null | 'monthly' | 'remaining'>(null);
  const incomeCount = incomeSources.length;
  const monthlyIncomeTotal = useMemo(() => totalMonthlyIncome(incomeSources), [incomeSources]);

  const {
    monthlyTotal,
    totalRemaining,
    paidSum,
    totalToPaySum,
    activeCount,
    upcoming,
    breakdown,
    remainingItems,
    months,
  } = useMemo(() => {
    const active = expenses.filter((o) => o.status !== 'closed');
    let monthlyTotal = 0;
    let totalRemaining = 0;
    let paidSum = 0;
    let totalToPaySum = 0;
    const upcoming: UpItem[] = [];
    const breakdown: FlowItem[] = [];
    const remainingItems: FlowItem[] = [];
    for (const o of active) {
      const c = computeObligation(o);
      monthlyTotal += c.monthlyPayment;
      totalRemaining += c.remaining;
      paidSum += c.paidSoFar;
      totalToPaySum += c.totalToPay;
      if (c.monthlyPayment > 0)
        breakdown.push({
          kind: 'obligation',
          id: o.id,
          name: o.name,
          value: Math.round(c.monthlyPayment),
        });
      if (c.remaining > 0)
        remainingItems.push({
          kind: 'obligation',
          id: o.id,
          name: o.name,
          value: Math.round(c.remaining),
        });
      if (c.nextPaymentDate)
        upcoming.push({
          kind: 'obligation',
          id: o.id,
          name: o.name,
          date: c.nextPaymentDate,
          amount: c.monthlyPayment,
          value: 0,
          tag: o.type,
        });
    }
    for (const r of recurring) {
      if (r.paused) continue;
      const c = computeRecurring(r);
      monthlyTotal += c.monthlyEquivalent;
      breakdown.push({
        kind: 'recurring',
        id: r.id,
        name: r.name,
        value: Math.round(c.monthlyEquivalent),
      });
      upcoming.push({
        kind: 'recurring',
        id: r.id,
        name: r.name,
        date: c.nextDue,
        amount: r.amount,
        value: 0,
        tag: 'recurring',
      });
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
    breakdown.sort((a, b) => b.value - a.value);
    remainingItems.sort((a, b) => b.value - a.value);

    // Next-6-months payment forecast (obligations + recurring).
    const base = new Date();
    const today = todayISO();
    const horizonEnd = toISO(new Date(base.getFullYear(), base.getMonth() + 6, 0));
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      const label = monthShortFmt.format(d).replace('.', '');
      return { y: d.getFullYear(), m: d.getMonth(), label, total: 0 };
    });
    for (const p of collectPayments(today, horizonEnd, expenses, recurring)) {
      const dt = parseISO(p.date);
      if (!dt) continue;
      const idx = (dt.getFullYear() - base.getFullYear()) * 12 + (dt.getMonth() - base.getMonth());
      if (idx >= 0 && idx < 6) months[idx].total += p.amount;
    }

    return {
      monthlyTotal,
      totalRemaining,
      paidSum,
      totalToPaySum,
      activeCount: active.length,
      upcoming,
      breakdown,
      remainingItems,
      months,
    };
  }, [expenses, recurring]);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };
  const openItem = (it: { kind: Kind; id: string }) => go(pathFor(it.kind, it.id));

  const barsTotal = Math.max(
    breakdown.reduce((sum, b) => sum + b.value, 0),
    1,
  );
  const paidPct = totalToPaySum > 0 ? Math.round((paidSum / totalToPaySum) * 100) : 0;
  const sparkMax = Math.max(...months.map((mo) => mo.total), 1);
  const hasForecast = months.some((mo) => mo.total > 0);

  if (!hydrated) {
    return (
      <Screen title="Финансы" subtitle="Обзор">
        <div className="stack">
          <div className="card hero">
            <Skeleton width={108} height={108} radius={54} />
            <div className="hero__main" style={{ display: 'grid', gap: 12 }}>
              <Skeleton height={18} />
              <Skeleton height={18} />
              <Skeleton height={14} width="55%" />
            </div>
          </div>
          <div className="card">
            <div className="stat-grid">
              <Skeleton height={52} />
              <Skeleton height={52} />
            </div>
          </div>
          <Skeleton height={70} radius={18} />
          <Skeleton height={70} radius={18} />
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      title="Финансы"
      subtitle="Обзор"
      action={
        <div className="row" style={{ gap: 8 }}>
          <button
            className="icon-round"
            onClick={() => go('/finance/settings')}
            aria-label="Напоминания"
          >
            <IconBell size={20} />
          </button>
          <button
            className="icon-round"
            onClick={() => go('/finance/calendar')}
            aria-label="Календарь"
          >
            <IconCalendar size={22} />
          </button>
        </div>
      }
    >
      <div className="stack">
        {totalToPaySum > 0 && (
          <div className="card hero">
            <ProgressRing percent={paidPct}>
              <div className="hero__pct">
                <AnimatedNumber value={paidPct} format={(n) => `${Math.round(n)}%`} />
                <small>выплачено</small>
              </div>
            </ProgressRing>
            <div className="hero__main">
              <div className="hero__row">
                <span>Выплачено</span>
                <b className="amount-pos">
                  <AnimatedNumber value={Math.round(paidSum)} format={formatRUB} />
                </b>
              </div>
              <div className="hero__row">
                <span>Осталось</span>
                <b>
                  <AnimatedNumber value={Math.round(totalRemaining)} format={formatRUB} />
                </b>
              </div>
              <div className="hero__row hero__row--muted">
                <span>Всего к выплате</span>
                <b>{formatRUB(Math.round(totalToPaySum))}</b>
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="stat-grid">
            <StatTile
              label="Платежей в месяц"
              value={<AnimatedNumber value={monthlyTotal} format={formatRUB} />}
              onClick={
                breakdown.length
                  ? () => {
                      tapLight();
                      setSheet('monthly');
                    }
                  : undefined
              }
            />
            <StatTile
              label="Осталось выплатить"
              value={<AnimatedNumber value={totalRemaining} format={formatRUB} />}
              onClick={
                remainingItems.length
                  ? () => {
                      tapLight();
                      setSheet('remaining');
                    }
                  : undefined
              }
            />
          </div>
        </div>

        {hasForecast && (
          <div className="card">
            <div className="spark-head">
              <span className="section-label" style={{ margin: 0 }}>
                Платежи вперёд
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                6 месяцев
              </span>
            </div>
            <div className="spark">
              {months.map((mo) => (
                <button
                  key={`${mo.y}-${mo.m}`}
                  className="spark__col"
                  onClick={() =>
                    go(`/finance/calendar?ym=${mo.y}-${String(mo.m + 1).padStart(2, '0')}`)
                  }
                >
                  <span className="spark__val">
                    {mo.total > 0 ? formatRUB(Math.round(mo.total)) : ''}
                  </span>
                  <span className="spark__track">
                    <span
                      className="spark__bar"
                      style={{
                        height: `${Math.max((mo.total / sparkMax) * 100, mo.total > 0 ? 6 : 0)}%`,
                      }}
                    />
                  </span>
                  <span className="spark__lbl">{mo.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="section-label">Разделы</div>
        <SectionCard
          icon={<IconChart />}
          title="Траты и доходы"
          sub="Дневник расходов и доходов по категориям"
          onClick={() => go('/finance/transactions')}
        />
        <SectionCard
          icon={<IconWallet />}
          title="Доходы"
          sub={
            incomeCount
              ? `${incomeCount} источник${incomeCount === 1 ? '' : 'ов'} • ≈ ${formatRUB(monthlyIncomeTotal)}/мес`
              : 'Оклад, вахта, смены, разовый доход'
          }
          onClick={() => go('/finance/income')}
        />
        <SectionCard
          icon={<IconWallet />}
          title="Мои расходы"
          sub={
            expenses.length || recurring.length
              ? `Платежи: ${activeCount} • регулярные: ${recurring.length}`
              : 'Кредиты, рассрочки, подписки'
          }
          onClick={() => go('/finance/expenses')}
        />
        <SectionCard
          icon={<IconList />}
          title="Списки"
          sub={
            lists.length ? `${lists.length} ${listsWord(lists.length)}` : 'Свадьба, ремонт, отпуск…'
          }
          onClick={() => go('/finance/lists')}
        />
        <SectionCard
          icon={<IconTarget />}
          title="Накопления"
          sub={
            savings.length
              ? `${savings.length} цел${savings.length === 1 ? 'ь' : 'и'}`
              : 'Цели и прогресс'
          }
          onClick={() => go('/finance/savings')}
        />

        {upcoming.length > 0 && (
          <>
            <SectionHeader
              title="Ближайшие платежи"
              action={
                <button className="link-all" onClick={() => go('/finance/calendar')}>
                  Все ›
                </button>
              }
            />
            <div className="stack">
              {upcoming.map((u) => (
                <div
                  key={u.kind + u.id}
                  className="up-row"
                  onClick={() => openItem(u)}
                  role="button"
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="up-row__name">{u.name}</div>
                    <div className="up-row__amount">{formatRUB(u.amount)}</div>
                    <span className={`badge ${TAG_META[u.tag].cls} up-row__tag`}>
                      {TAG_META[u.tag].label}
                    </span>
                  </div>
                  <div className="up-row__date">{formatDate(u.date, true)}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {breakdown.length > 0 && (
          <>
            <div className="section-label">Платежи в месяц</div>
            <div className="card">
              <p className="muted bar-caption">Доля каждого платежа в месячных тратах</p>
              <div className="stack" style={{ gap: 14 }}>
                {breakdown.map((it) => {
                  const pct = Math.round((it.value / barsTotal) * 100);
                  return (
                    <div
                      key={it.kind + it.id}
                      className="bar-row"
                      onClick={() => openItem(it)}
                      role="button"
                    >
                      <div className="bar-row__head">
                        <span className="bar-row__name">{it.name}</span>
                        <span className="bar-row__val">
                          {formatRUB(it.value)} <i>· {pct}%</i>
                        </span>
                      </div>
                      <div className="progress">
                        <div className="progress__fill" style={{ width: `${Math.max(pct, 2)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {sheet === 'monthly' && (
        <Sheet title="Из чего складывается" onClose={() => setSheet(null)}>
          <FlowList
            items={breakdown}
            onPick={(it) => {
              setSheet(null);
              openItem(it);
            }}
          />
        </Sheet>
      )}
      {sheet === 'remaining' && (
        <Sheet title="Осталось выплатить" onClose={() => setSheet(null)}>
          <FlowList
            items={remainingItems}
            onPick={(it) => {
              setSheet(null);
              openItem(it);
            }}
          />
        </Sheet>
      )}
    </Screen>
  );
}
