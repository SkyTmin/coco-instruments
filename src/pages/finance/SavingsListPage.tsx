import { useNavigate } from 'react-router-dom';
import { EmptyState, Fab, ProgressBar, Screen } from '@/components/ui';
import { useFinanceStore } from '@/store';
import { computeSavings } from '@/lib/finance-calc';
import type { SavingsGoal } from '@/types';
import { formatRUB } from '@/lib/format';
import { tapLight } from '@/lib/haptics';

function SavingsCard({ g, onClick }: { g: SavingsGoal; onClick: () => void }) {
  const s = computeSavings(g.targetAmount, g.currentAmount, g.deadline);
  return (
    <div className="obl-card" onClick={onClick} role="button">
      <div className="obl-card__top">
        <span className="obl-card__name">{g.name}</span>
        <span className="badge badge--single">{s.progressPercent}%</span>
      </div>
      <div className="obl-card__nums">
        <span className="obl-card__remain">{formatRUB(g.currentAmount)}</span>
        <span className="obl-card__total">из {formatRUB(g.targetAmount)}</span>
      </div>
      <ProgressBar percent={s.progressPercent} />
    </div>
  );
}

export function SavingsListPage() {
  const navigate = useNavigate();
  const savings = useFinanceStore((s) => s.savings);

  return (
    <Screen title="Накопления">
      {savings.length === 0 ? (
        <EmptyState
          icon="🎯"
          title="Пока нет целей"
          sub="Поставьте цель: сколько хотите накопить — и следите за прогрессом"
        />
      ) : (
        <div className="stack">
          {savings.map((g) => (
            <SavingsCard
              key={g.id}
              g={g}
              onClick={() => {
                tapLight();
                navigate(`/finance/savings/${g.id}`);
              }}
            />
          ))}
        </div>
      )}
      <Fab
        onClick={() => {
          tapLight();
          navigate('/finance/savings/new');
        }}
      />
    </Screen>
  );
}
