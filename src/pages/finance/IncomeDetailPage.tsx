import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState, Screen } from '@/components/ui';
import { IconPencil } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { incomeOccurrences, monthlyIncome } from '@/lib/income';
import { addMonths, parseISO, toISO, todayISO } from '@/lib/date';
import { formatDate, formatRUB } from '@/lib/format';
import { notifySuccess, tapLight } from '@/lib/haptics';

const KIND_LABEL: Record<string, string> = {
  advance: 'Аванс',
  salary: 'Зарплата',
  payout: 'Выплата',
};
const KIND_CATEGORY: Record<string, string> = {
  advance: 'advance',
  salary: 'salary',
  payout: 'salary',
};

export function IncomeDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const source = useFinanceStore((s) => (id ? s.getIncomeSource(id) : undefined));
  const updateIncomeSource = useFinanceStore((s) => s.updateIncomeSource);
  const addTransaction = useFinanceStore((s) => s.addTransaction);

  const upcoming = useMemo(() => {
    if (!source) return [];
    const today = todayISO();
    const until = toISO(addMonths(parseISO(today) ?? new Date(), 6, 1));
    return incomeOccurrences(source, today, until).slice(0, 8);
  }, [source]);

  if (!source) {
    return (
      <Screen title="Доход">
        <EmptyState icon="🤷" title="Источник не найден" />
      </Screen>
    );
  }

  const monthly = monthlyIncome(source);
  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  const logPayout = (ev: { date: string; amount: number; kind: string }) => {
    addTransaction({
      direction: 'income',
      amount: ev.amount,
      date: ev.date,
      category: KIND_CATEGORY[ev.kind] ?? 'salary',
      note: source.name,
      incomeSourceId: source.id,
    });
    notifySuccess();
    navigate('/finance/transactions');
  };

  return (
    <Screen
      title={source.name}
      action={
        <button
          className="icon-round"
          onClick={() => go(`/finance/income/${source.id}/edit`)}
          aria-label="Изменить"
        >
          <IconPencil size={20} />
        </button>
      }
    >
      <div className="card">
        {monthly > 0 && (
          <div className="stat-row">
            <span className="stat-row__label">≈ доход в месяц</span>
            <span className="stat-row__value amount-pos">{formatRUB(monthly)}</span>
          </div>
        )}
        {source.paused && (
          <div className="stat-row">
            <span className="stat-row__label">Статус</span>
            <span className="stat-row__value">На паузе</span>
          </div>
        )}
        <label className="toggle-row" style={{ marginTop: 8 }}>
          <span>⏸ На паузе (не учитывать)</span>
          <input
            type="checkbox"
            checked={source.paused ?? false}
            onChange={(e) => updateIncomeSource(source.id, { paused: e.target.checked })}
          />
        </label>
      </div>

      <div className="section-label">Ближайшие выплаты</div>
      {upcoming.length === 0 ? (
        <EmptyState icon="📭" title="Нет выплат в ближайшие полгода" />
      ) : (
        <div className="stack">
          {upcoming.map((ev, i) => (
            <div key={`${ev.date}-${i}`} className="tx-row" style={{ padding: '12px 14px' }}>
              <div className="tx-row__body">
                <div className="tx-row__title">{KIND_LABEL[ev.kind] ?? 'Выплата'}</div>
                <div className="tx-row__sub">{formatDate(ev.date)}</div>
              </div>
              <span className="tx-row__amount amount-pos">{formatRUB(ev.amount)}</span>
              <button
                className="btn btn--ghost btn--sm"
                style={{ marginLeft: 10 }}
                onClick={() => logPayout(ev)}
              >
                Записать
              </button>
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}
