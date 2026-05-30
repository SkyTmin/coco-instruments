import { useNavigate } from 'react-router-dom';
import { EmptyState, Fab, Screen } from '@/components/ui';
import { IconChevron } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { computeObligation, computeRecurring } from '@/lib/finance-calc';
import { formatRUB } from '@/lib/format';
import { tapLight } from '@/lib/haptics';

export function ListsPage() {
  const navigate = useNavigate();
  const lists = useFinanceStore((s) => s.lists);
  const expenses = useFinanceStore((s) => s.expenses);
  const recurring = useFinanceStore((s) => s.recurring);

  const statsFor = (id: string) => {
    const obls = expenses.filter((o) => o.listId === id);
    const recs = recurring.filter((r) => r.listId === id);
    let remaining = 0;
    for (const o of obls) {
      if (o.status !== 'closed') remaining += computeObligation(o).remaining;
    }
    return { count: obls.length + recs.length, remaining };
  };

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  return (
    <Screen title="Списки" subtitle="Расходы по проектам">
      {lists.length === 0 ? (
        <EmptyState
          icon="📂"
          title="Пока нет списков"
          sub="Например «Свадьба» или «Ремонт» — соберите туда связанные расходы"
        />
      ) : (
        <div className="stack">
          {lists.map((l) => {
            const s = statsFor(l.id);
            return (
              <div key={l.id} className="section-card" onClick={() => go(`/finance/lists/${l.id}`)} role="button">
                <div className="section-card__icon" style={{ background: 'var(--surface-2)', fontSize: 22 }}>
                  {l.emoji || '📂'}
                </div>
                <div className="section-card__body">
                  <div className="section-card__title">{l.name}</div>
                  <div className="section-card__sub">
                    {s.count ? `${s.count} поз. · осталось ${formatRUB(s.remaining)}` : 'Пусто'}
                  </div>
                </div>
                <IconChevron className="chev" size={20} />
              </div>
            );
          })}
        </div>
      )}
      <Fab onClick={() => go('/finance/lists/new')} />
    </Screen>
  );
}
