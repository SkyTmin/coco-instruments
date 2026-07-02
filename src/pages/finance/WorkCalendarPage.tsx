import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState, Screen } from '@/components/ui';
import { IconChart, IconChevron } from '@/components/icons';
import type { WorkDayMark } from '@/types';
import { useFinanceStore } from '@/store';
import { computePayslip, monthDays } from '@/lib/salary';
import { addMonths, parseISO, toISO, todayISO } from '@/lib/date';
import { formatRUB } from '@/lib/format';
import { selectionChanged, tapLight } from '@/lib/haptics';

const monthTitleFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Tapping a day walks through these states (then back to auto = clear). */
const CYCLE: (WorkDayMark | null)[] = [
  { kind: 'work' },
  { kind: 'work', night: true },
  { kind: 'holiday' },
  { kind: 'off' },
  null, // back to auto cycle
];

function markLabel(m: WorkDayMark): { cls: string; badge: string } {
  if (m.kind === 'off') return { cls: 'wc-day--off', badge: '' };
  if (m.kind === 'holiday') return { cls: 'wc-day--holiday', badge: '★' };
  if (m.night) return { cls: 'wc-day--night', badge: '🌙' };
  return { cls: 'wc-day--work', badge: '' };
}

const sameMark = (a: WorkDayMark, b: WorkDayMark | null) =>
  !!b && a.kind === b.kind && !!a.night === !!b.night;

export function WorkCalendarPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const source = useFinanceStore((s) => (id ? s.getIncomeSource(id) : undefined));
  const updateIncomeSource = useFinanceStore((s) => s.updateIncomeSource);
  const [anchor, setAnchor] = useState(todayISO());

  const month = anchor.slice(0, 7);
  const days = useMemo(() => (source ? monthDays(source, month) : []), [source, month]);
  const payslip = useMemo(() => (source ? computePayslip(source, month) : null), [source, month]);

  if (!source) {
    return (
      <Screen title="Календарь смен">
        <EmptyState icon="🤷" title="Источник не найден" />
      </Screen>
    );
  }

  const shiftMonth = (delta: number) => {
    tapLight();
    setAnchor(toISO(addMonths(parseISO(anchor) ?? new Date(), delta, 1)));
  };

  const cycleDay = (date: string, current: WorkDayMark) => {
    selectionChanged();
    // Find current position in the cycle, advance to the next.
    const idx = CYCLE.findIndex((c) => sameMark(current, c));
    const next = CYCLE[(idx + 1) % CYCLE.length];
    const cal = { ...(source.calendar ?? {}) };
    if (next === null) delete cal[date];
    else cal[date] = next;
    updateIncomeSource(source.id, { calendar: cal });
  };

  // Leading blanks so the 1st lands under its weekday (Mon-based).
  const firstDow = ((parseISO(`${month}-01`)?.getDay() ?? 1) + 6) % 7;

  return (
    <Screen
      title="Календарь смен"
      subtitle={source.name}
      action={
        <button
          className="icon-round"
          onClick={() => navigate(`/finance/income/${source.id}/payslip`)}
          aria-label="Расчётный лист"
        >
          <IconChart size={20} />
        </button>
      }
    >
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

      <p className="muted" style={{ fontSize: 12, margin: '0 2px 10px' }}>
        Нажимайте на день: рабочий → ночная → праздник → выходной → авто по графику.
      </p>

      <div className="wc-grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="wc-dow">
            {w}
          </div>
        ))}
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`b${i}`} />
        ))}
        {days.map((d) => {
          const { cls, badge } = markLabel(d.mark);
          const dayNum = Number(d.date.slice(8, 10));
          return (
            <button
              key={d.date}
              className={`wc-day ${cls}${d.manual ? ' wc-day--manual' : ''}`}
              onClick={() => cycleDay(d.date, d.mark)}
            >
              <span className="wc-day__num">{dayNum}</span>
              {badge && <span className="wc-day__badge">{badge}</span>}
            </button>
          );
        })}
      </div>

      {payslip && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="stat-row">
            <span className="stat-row__label">Смен в месяце</span>
            <span className="stat-row__value">{payslip.stats.workDays}</span>
          </div>
          <div className="stat-row">
            <span className="stat-row__label">На руки за месяц</span>
            <span className="stat-row__value amount-pos">{formatRUB(payslip.net)}</span>
          </div>
          <button
            className="btn btn--primary btn--block"
            style={{ marginTop: 12 }}
            onClick={() => navigate(`/finance/income/${source.id}/payslip`)}
          >
            Открыть расчётный лист
          </button>
        </div>
      )}
    </Screen>
  );
}
