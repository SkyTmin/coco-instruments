import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatedNumber, Screen, SectionCard, SectionHeader, Sheet, StatTile } from '@/components/ui';
import { IconBell, IconCalendar, IconList, IconTarget, IconWallet } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { computeObligation, computeRecurring } from '@/lib/finance-calc';
import { formatDate, formatRUB } from '@/lib/format';
import { tapLight } from '@/lib/haptics';

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
  const [sheet, setSheet] = useState<null | 'monthly' | 'remaining'>(null);

  const { monthlyTotal, totalRemaining, activeCount, upcoming, breakdown, remainingItems } = useMemo(() => {
    const active = expenses.filter((o) => o.status !== 'closed');
    let monthlyTotal = 0;
    let totalRemaining = 0;
    const upcoming: UpItem[] = [];
    const breakdown: FlowItem[] = [];
    const remainingItems: FlowItem[] = [];
    for (const o of active) {
      const c = computeObligation(o);
      monthlyTotal += c.monthlyPayment;
      totalRemaining += c.remaining;
      if (c.monthlyPayment > 0)
        breakdown.push({ kind: 'obligation', id: o.id, name: o.name, value: Math.round(c.monthlyPayment) });
      if (c.remaining > 0)
        remainingItems.push({ kind: 'obligation', id: o.id, name: o.name, value: Math.round(c.remaining) });
      if (c.nextPaymentDate)
        upcoming.push({ kind: 'obligation', id: o.id, name: o.name, date: c.nextPaymentDate, amount: c.monthlyPayment, value: 0, tag: o.type });
    }
    for (const r of recurring) {
      if (r.paused) continue;
      const c = computeRecurring(r);
      monthlyTotal += c.monthlyEquivalent;
      breakdown.push({ kind: 'recurring', id: r.id, name: r.name, value: Math.round(c.monthlyEquivalent) });
      upcoming.push({ kind: 'recurring', id: r.id, name: r.name, date: c.nextDue, amount: r.amount, value: 0, tag: 'recurring' });
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
    breakdown.sort((a, b) => b.value - a.value);
    remainingItems.sort((a, b) => b.value - a.value);
    return { monthlyTotal, totalRemaining, activeCount: active.length, upcoming, breakdown, remainingItems };
  }, [expenses, recurring]);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };
  const openItem = (it: { kind: Kind; id: string }) => go(pathFor(it.kind, it.id));

  const barsTotal = Math.max(breakdown.reduce((sum, b) => sum + b.value, 0), 1);

  return (
    <Screen
      title="Финансы"
      subtitle="Обзор"
      action={
        <div className="row" style={{ gap: 8 }}>
          <button className="icon-round" onClick={() => go('/finance/settings')} aria-label="Напоминания">
            <IconBell size={20} />
          </button>
          <button className="icon-round" onClick={() => go('/finance/calendar')} aria-label="Календарь">
            <IconCalendar size={22} />
          </button>
        </div>
      }
    >
      <div className="stack">
        <div className="card">
          <div className="stat-grid">
            <StatTile
              label="Платежей в месяц"
              value={<AnimatedNumber value={monthlyTotal} format={formatRUB} />}
              onClick={breakdown.length ? () => { tapLight(); setSheet('monthly'); } : undefined}
            />
            <StatTile
              label="Осталось выплатить"
              value={<AnimatedNumber value={totalRemaining} format={formatRUB} />}
              onClick={remainingItems.length ? () => { tapLight(); setSheet('remaining'); } : undefined}
            />
          </div>
        </div>

        <div className="section-label">Разделы</div>
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
          sub={lists.length ? `${lists.length} ${listsWord(lists.length)}` : 'Свадьба, ремонт, отпуск…'}
          onClick={() => go('/finance/lists')}
        />
        <SectionCard
          icon={<IconTarget />}
          title="Накопления"
          sub={savings.length ? `${savings.length} цел${savings.length === 1 ? 'ь' : 'и'}` : 'Цели и прогресс'}
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
                <div key={u.kind + u.id} className="up-row" onClick={() => openItem(u)} role="button">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="up-row__name">{u.name}</div>
                    <div className="up-row__amount">{formatRUB(u.amount)}</div>
                    <span className={`badge ${TAG_META[u.tag].cls} up-row__tag`}>{TAG_META[u.tag].label}</span>
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
                    <div key={it.kind + it.id} className="bar-row" onClick={() => openItem(it)} role="button">
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
          <FlowList items={breakdown} onPick={(it) => { setSheet(null); openItem(it); }} />
        </Sheet>
      )}
      {sheet === 'remaining' && (
        <Sheet title="Осталось выплатить" onClose={() => setSheet(null)}>
          <FlowList items={remainingItems} onPick={(it) => { setSheet(null); openItem(it); }} />
        </Sheet>
      )}
    </Screen>
  );
}
