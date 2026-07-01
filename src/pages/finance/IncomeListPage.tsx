import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog, EmptyState, Fab, Screen, StatTile, SwipeRow } from '@/components/ui';
import { IconPencil, IconTrash } from '@/components/icons';
import type { IncomeScheme, IncomeSource } from '@/types';
import { useFinanceStore } from '@/store';
import { monthlyIncome, nextIncome, totalMonthlyIncome } from '@/lib/income';
import { formatDate, formatRUB } from '@/lib/format';
import { notifyWarning, tapLight } from '@/lib/haptics';

const SCHEME_META: Record<IncomeScheme, { emoji: string; label: string }> = {
  salary: { emoji: '💼', label: 'Оклад' },
  vahta: { emoji: '⛏', label: 'Вахта' },
  shift: { emoji: '🕑', label: 'Смены' },
  recurring: { emoji: '🔁', label: 'Регулярный' },
  oneoff: { emoji: '➕', label: 'Разовый' },
};

export function IncomeListPage() {
  const navigate = useNavigate();
  const sources = useFinanceStore((s) => s.incomeSources);
  const removeIncomeSource = useFinanceStore((s) => s.removeIncomeSource);
  const [confirm, setConfirm] = useState<IncomeSource | null>(null);

  const totalMonthly = useMemo(() => totalMonthlyIncome(sources), [sources]);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };
  const doDelete = () => {
    if (!confirm) return;
    notifyWarning();
    removeIncomeSource(confirm.id);
    setConfirm(null);
  };

  return (
    <Screen title="Доходы" subtitle="Источники и зарплаты">
      {sources.length === 0 ? (
        <EmptyState
          icon="💰"
          title="Пока нет источников дохода"
          sub="Добавьте оклад, вахту, смены или разовый доход — приложение посчитает выплаты"
        />
      ) : (
        <>
          <div className="card">
            <div className="stat-grid">
              <StatTile
                label="Ожидаемый доход в месяц"
                value={<span className="amount-pos">{formatRUB(totalMonthly)}</span>}
              />
            </div>
          </div>
          <div className="stack" style={{ marginTop: 4 }}>
            {sources.map((s) => {
              const meta = SCHEME_META[s.scheme];
              const next = nextIncome(s);
              const monthly = monthlyIncome(s);
              return (
                <SwipeRow
                  key={s.id}
                  onTap={() => go(`/finance/income/${s.id}`)}
                  actions={[
                    {
                      icon: <IconPencil size={19} />,
                      label: 'Изменить',
                      onClick: () => go(`/finance/income/${s.id}/edit`),
                    },
                    {
                      icon: <IconTrash size={19} />,
                      label: 'Удалить',
                      danger: true,
                      onClick: () => setConfirm(s),
                    },
                  ]}
                >
                  <div className="tx-row">
                    <span className="tx-row__icon" style={{ background: 'var(--surface-2)' }}>
                      {meta.emoji}
                    </span>
                    <div className="tx-row__body">
                      <div className="tx-row__title">
                        {s.name}
                        {s.paused ? ' · на паузе' : ''}
                      </div>
                      <div className="tx-row__sub">
                        {meta.label}
                        {next ? ` · след. ${formatDate(next.date, true)}` : ''}
                      </div>
                    </div>
                    {monthly > 0 && (
                      <span className="tx-row__amount amount-pos">≈{formatRUB(monthly)}</span>
                    )}
                  </div>
                </SwipeRow>
              );
            })}
          </div>
        </>
      )}

      <Fab onClick={() => go('/finance/income/new')} />

      {confirm && (
        <ConfirmDialog
          message={`Удалить источник «${confirm.name}»?`}
          onConfirm={doDelete}
          onClose={() => setConfirm(null)}
        />
      )}
    </Screen>
  );
}
