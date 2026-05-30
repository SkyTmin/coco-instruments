import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, SectionCard, Sheet, StatTile } from '@/components/ui';
import { IconList, IconTarget, IconWallet } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { computeObligation, computeRecurring } from '@/lib/finance-calc';
import { formatDate, formatRUB } from '@/lib/format';
import { tapLight } from '@/lib/haptics';

type Kind = 'obligation' | 'recurring';
interface FlowItem {
  kind: Kind;
  id: string;
  name: string;
  value: number;
}
interface UpItem extends FlowItem {
  date: string;
  amount: number;
}

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
    <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
      {items.map((it) => (
        <div key={it.kind + it.id} className="pay-row pay-row--tap" onClick={() => onPick(it)} role="button">
          <span style={{ flex: 1 }}>{it.name}</span>
          <span style={{ fontWeight: 700 }}>{formatRUB(it.value)}</span>
        </div>
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
        upcoming.push({ kind: 'obligation', id: o.id, name: o.name, date: c.nextPaymentDate, amount: c.monthlyPayment, value: 0 });
    }
    for (const r of recurring) {
      if (r.paused) continue;
      const c = computeRecurring(r);
      monthlyTotal += c.monthlyEquivalent;
      breakdown.push({ kind: 'recurring', id: r.id, name: r.name, value: Math.round(c.monthlyEquivalent) });
      upcoming.push({ kind: 'recurring', id: r.id, name: r.name, date: c.nextDue, amount: r.amount, value: 0 });
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

  const max = Math.max(...breakdown.map((b) => b.value), 1);
  const next = upcoming[0];
  const rest = upcoming.slice(1);

  return (
    <Screen title="Финансы" subtitle="Обзор">
      <div className="stack">
        <div className="card">
          <div className="stat-grid">
            <StatTile
              label="Платежей в месяц"
              value={formatRUB(monthlyTotal)}
              onClick={breakdown.length ? () => { tapLight(); setSheet('monthly'); } : undefined}
            />
            <StatTile
              label="Осталось выплатить"
              value={formatRUB(totalRemaining)}
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

        {next && (
          <>
            <div className="section-label">Ближайшие платежи</div>
            <div className="next-pay next-pay--tap" onClick={() => openItem(next)} role="button">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, opacity: 0.9 }}>{next.name}</div>
                <div className="next-pay__big">{formatRUB(next.amount)}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 13 }}>{formatDate(next.date, true)}</div>
            </div>
            {rest.length > 0 && (
              <div className="card">
                {rest.map((u) => (
                  <div key={u.kind + u.id} className="pay-row pay-row--tap" onClick={() => openItem(u)} role="button">
                    <div style={{ flex: 1 }}>
                      <div className="pay-row__amount">{u.name}</div>
                      <div className="pay-row__date">{formatDate(u.date, true)}</div>
                    </div>
                    <span style={{ fontWeight: 700 }}>{formatRUB(u.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {breakdown.length > 0 && (
          <>
            <div className="section-label">Платежи в месяц</div>
            <div className="card">
              <div className="stack" style={{ gap: 14 }}>
                {breakdown.map((it) => (
                  <div key={it.kind + it.id} onClick={() => openItem(it)} role="button" style={{ cursor: 'pointer' }}>
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.name}
                      </span>
                      <span style={{ fontWeight: 700, flex: 'none' }}>{formatRUB(it.value)}</span>
                    </div>
                    <div className="progress">
                      <div className="progress__fill" style={{ width: `${(it.value / max) * 100}%` }} />
                    </div>
                  </div>
                ))}
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
