import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState, Screen } from '@/components/ui';
import { IconChevron } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { computePayslip, payslipRangeTotal } from '@/lib/salary';
import { addMonths, parseISO, toISO, todayISO } from '@/lib/date';
import { formatRUB } from '@/lib/format';
import { notifySuccess, tapLight } from '@/lib/haptics';

const monthTitleFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

export function PayslipPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const source = useFinanceStore((s) => (id ? s.getIncomeSource(id) : undefined));
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const [anchor, setAnchor] = useState(todayISO());

  const month = anchor.slice(0, 7);
  const payslip = useMemo(() => (source ? computePayslip(source, month) : null), [source, month]);
  // Прогноз «за вахту»: суммируем текущий и следующий месяц (один полный цикл).
  const forecast = useMemo(() => {
    if (!source) return null;
    const next = toISO(addMonths(parseISO(anchor) ?? new Date(), 1, 1)).slice(0, 7);
    return payslipRangeTotal(source, [month, next]);
  }, [source, anchor, month]);

  if (!source || !payslip) {
    return (
      <Screen title="Расчётный лист">
        <EmptyState icon="🤷" title="Источник не найден" />
      </Screen>
    );
  }

  const shiftMonth = (delta: number) => {
    tapLight();
    setAnchor(toISO(addMonths(parseISO(anchor) ?? new Date(), delta, 1)));
  };

  const logSalary = () => {
    addTransaction({
      direction: 'income',
      amount: payslip.net,
      date: `${month}-${String(source.salaryDay || 10).padStart(2, '0')}`,
      category: 'salary',
      note: `${source.name} · зарплата`,
      incomeSourceId: source.id,
    });
    notifySuccess();
    navigate('/finance/transactions');
  };

  return (
    <Screen title="Расчётный лист" subtitle={source.name}>
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
        <div className="payslip-head">
          Начислено
          <span className="muted"> · {payslip.stats.workDays} смен</span>
        </div>
        {payslip.accruals.map((l) => (
          <div key={l.id} className="stat-row">
            <span className="stat-row__label">{l.label}</span>
            <span className="stat-row__value">{formatRUB(l.amount)}</span>
          </div>
        ))}
        <div className="stat-row payslip-total">
          <span className="stat-row__label">Итого начислено</span>
          <span className="stat-row__value">{formatRUB(payslip.gross)}</span>
        </div>
      </div>

      {payslip.deductions.length > 0 && (
        <div className="card">
          <div className="payslip-head">Удержано</div>
          {payslip.deductions.map((l) => (
            <div key={l.id} className="stat-row">
              <span className="stat-row__label">{l.label}</span>
              <span className="stat-row__value amount-neg">−{formatRUB(l.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="stat-row payslip-total">
          <span className="stat-row__label">К выплате</span>
          <span className="stat-row__value amount-pos">{formatRUB(payslip.net)}</span>
        </div>
        <div className="stat-row">
          <span className="stat-row__label">Аванс</span>
          <span className="stat-row__value">{formatRUB(payslip.advance)}</span>
        </div>
        <div className="stat-row">
          <span className="stat-row__label">Зарплата (остаток)</span>
          <span className="stat-row__value">{formatRUB(payslip.salary)}</span>
        </div>
      </div>

      {forecast && (
        <div className="card">
          <div className="payslip-head">Прогноз за вахту (2 месяца)</div>
          <div className="stat-row">
            <span className="stat-row__label">Заработаю на руки</span>
            <span className="stat-row__value amount-pos">{formatRUB(forecast.net)}</span>
          </div>
          <div className="stat-row">
            <span className="stat-row__label">Авансом / зарплатой</span>
            <span className="stat-row__value">
              {formatRUB(forecast.advance)} / {formatRUB(forecast.salary)}
            </span>
          </div>
        </div>
      )}

      <button className="btn btn--primary btn--block" onClick={logSalary}>
        Записать зарплату в дневник
      </button>
      <button
        className="btn btn--ghost btn--block"
        style={{ marginTop: 8 }}
        onClick={() => navigate(`/finance/income/${source.id}/calendar`)}
      >
        🗓 Календарь смен
      </button>
    </Screen>
  );
}
