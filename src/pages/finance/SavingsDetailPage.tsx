import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog, ProgressBar, Screen, Sheet, StatTile } from '@/components/ui';
import { IconPencil, IconTrash } from '@/components/icons';
import { SavingsDonut } from '@/charts';
import { useFinanceStore } from '@/store';
import { computeSavings } from '@/lib/finance-calc';
import { formatDate, formatRUB } from '@/lib/format';
import { notifySuccess, notifyWarning, tapLight } from '@/lib/haptics';

function num(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function TopUpSheet({
  current,
  onClose,
  onSave,
}: {
  current: number;
  onClose: () => void;
  onSave: (newCurrent: number) => void;
}) {
  const [add, setAdd] = useState('');
  const valid = num(add) !== 0;
  return (
    <Sheet title="Пополнить" onClose={onClose}>
      <div className="field">
        <label className="field__label">Сколько добавить</label>
        <input
          className="input"
          inputMode="decimal"
          value={add}
          onChange={(e) => setAdd(e.target.value)}
          placeholder="5000"
        />
      </div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 14, fontSize: 13 }}>
        Станет: {formatRUB(Math.max(0, current + num(add)))}
      </p>
      <button
        className="btn btn--primary btn--block"
        disabled={!valid}
        onClick={() => onSave(Math.max(0, current + num(add)))}
      >
        Сохранить
      </button>
    </Sheet>
  );
}

export function SavingsDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const goal = useFinanceStore((s) => (id ? s.getSaving(id) : undefined));
  const updateSaving = useFinanceStore((s) => s.updateSaving);
  const removeSaving = useFinanceStore((s) => s.removeSaving);

  const [topUp, setTopUp] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  if (!goal || !id) return <Navigate to="/finance/savings" replace />;
  const s = computeSavings(goal.targetAmount, goal.currentAmount, goal.deadline);

  return (
    <Screen title={goal.name}>
      <div className="stack">
        <div className="chart-card">
          <SavingsDonut current={goal.currentAmount} target={goal.targetAmount} />
          <div className="center" style={{ marginTop: -4, marginBottom: 6 }}>
            <span style={{ fontSize: 26, fontWeight: 800 }}>{s.progressPercent}%</span>
          </div>
        </div>

        <div className="card">
          <ProgressBar percent={s.progressPercent} large />
          <div className="stat-grid" style={{ marginTop: 14 }}>
            <StatTile label="Накоплено" value={formatRUB(goal.currentAmount)} />
            <StatTile label="Осталось" value={formatRUB(s.remaining)} />
            <StatTile label="Цель" value={formatRUB(goal.targetAmount)} />
            {goal.deadline && <StatTile label="Срок" value={formatDate(goal.deadline, true)} />}
          </div>
          {s.requiredPerMonth != null && s.requiredPerMonth > 0 && (
            <div className="stat-row" style={{ marginTop: 6 }}>
              <span className="stat-row__label">Нужно откладывать в месяц</span>
              <span className="stat-row__value">{formatRUB(Math.ceil(s.requiredPerMonth))}</span>
            </div>
          )}
        </div>

        <button
          className="btn btn--primary btn--block"
          onClick={() => {
            tapLight();
            setTopUp(true);
          }}
        >
          Пополнить
        </button>

        <div className="row" style={{ gap: 12 }}>
          <button
            className="btn btn--block"
            style={{ flex: 1 }}
            onClick={() => {
              tapLight();
              navigate(`/finance/savings/${id}/edit`);
            }}
          >
            <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <IconPencil size={18} /> Изменить
            </span>
          </button>
          <button className="btn btn--danger" onClick={() => setConfirmDel(true)} aria-label="Удалить">
            <IconTrash size={18} />
          </button>
        </div>
      </div>

      {topUp && (
        <TopUpSheet
          current={goal.currentAmount}
          onClose={() => setTopUp(false)}
          onSave={(newCurrent) => {
            updateSaving(id, { currentAmount: newCurrent });
            notifySuccess();
            setTopUp(false);
          }}
        />
      )}

      {confirmDel && (
        <ConfirmDialog
          message={`Удалить цель «${goal.name}»?`}
          onConfirm={() => {
            removeSaving(id);
            notifyWarning();
            navigate('/finance/savings', { replace: true });
          }}
          onClose={() => setConfirmDel(false)}
        />
      )}
    </Screen>
  );
}
