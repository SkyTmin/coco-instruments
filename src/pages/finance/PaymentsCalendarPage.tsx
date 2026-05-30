import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { useFinanceStore } from '@/store';
import { collectPayments, type CalendarPayment } from '@/lib/finance-calc';
import { toISO, todayISO } from '@/lib/date';
import { formatDate, formatRUB } from '@/lib/format';
import { tapLight } from '@/lib/haptics';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const pathFor = (p: CalendarPayment) =>
  p.kind === 'recurring' ? `/finance/recurring/${p.id}` : `/finance/expenses/${p.id}`;

function monthTitle(y: number, m: number): string {
  const s = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(y, m, 1));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function PaymentsCalendarPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const listId = params.get('list') || undefined;
  const expenses = useFinanceStore((s) => s.expenses);
  const recurring = useFinanceStore((s) => s.recurring);
  const lists = useFinanceStore((s) => s.lists);

  const today = todayISO();
  const now = new Date();
  const [cursor, setCursor] = useState(() => ({ y: now.getFullYear(), m: now.getMonth() }));
  const [selected, setSelected] = useState<string>(today);

  const { byDay, monthTotal, cells } = useMemo(() => {
    // 6-week grid (Monday-first), incl. trailing/leading days of adjacent months.
    const first = new Date(cursor.y, cursor.m, 1);
    const offset = (first.getDay() + 6) % 7;
    const gridStart = new Date(cursor.y, cursor.m, 1 - offset);
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });

    // Collect payments for the WHOLE visible grid (so adjacent-month days are
    // accurate too), clamped to today so only upcoming charges show.
    const gridStartISO = toISO(cells[0]);
    const gridEndISO = toISO(cells[41]);
    const rangeStart = gridStartISO < today ? today : gridStartISO;
    const payments = collectPayments(rangeStart, gridEndISO, expenses, recurring, listId);

    const byDay = new Map<string, CalendarPayment[]>();
    const mStart = toISO(new Date(cursor.y, cursor.m, 1));
    const mEnd = toISO(new Date(cursor.y, cursor.m + 1, 0));
    let monthTotal = 0;
    for (const p of payments) {
      const arr = byDay.get(p.date) ?? [];
      arr.push(p);
      byDay.set(p.date, arr);
      if (p.date >= mStart && p.date <= mEnd) monthTotal += p.amount;
    }
    return { byDay, monthTotal, cells };
  }, [cursor, expenses, recurring, listId, today]);

  const shift = (delta: number) => {
    tapLight();
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  // Tapping any day selects it; if it belongs to an adjacent month, follow it.
  const pickDay = (d: Date) => {
    tapLight();
    setSelected(toISO(d));
    if (d.getMonth() !== cursor.m || d.getFullYear() !== cursor.y) {
      setCursor({ y: d.getFullYear(), m: d.getMonth() });
    }
  };

  const goToday = () => {
    tapLight();
    setCursor({ y: now.getFullYear(), m: now.getMonth() });
    setSelected(today);
  };

  const isCurrentMonth = cursor.y === now.getFullYear() && cursor.m === now.getMonth();
  const dayPayments = byDay.get(selected) ?? [];
  const listName = listId ? lists.find((l) => l.id === listId)?.name : undefined;

  return (
    <Screen title="Календарь" subtitle={listName ? `Список «${listName}»` : 'Будущие платежи'}>
      <div className="cal">
        <div className="cal__head">
          <button className="cal__nav" onClick={() => shift(-1)} aria-label="Предыдущий месяц">
            ‹
          </button>
          <div className="cal__title">{monthTitle(cursor.y, cursor.m)}</div>
          <button className="cal__nav" onClick={() => shift(1)} aria-label="Следующий месяц">
            ›
          </button>
        </div>

        <div className="cal__week">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div className="cal__grid">
          {cells.map((d) => {
            const iso = toISO(d);
            const inMonth = d.getMonth() === cursor.m;
            const has = byDay.has(iso);
            return (
              <button
                key={iso}
                className={`cal__day${inMonth ? '' : ' is-out'}${iso === selected ? ' is-sel' : ''}${
                  iso === today ? ' is-today' : ''
                }${has ? ' has-pay' : ''}`}
                onClick={() => pickDay(d)}
              >
                <span>{d.getDate()}</span>
                {has && <i className="cal__dot" />}
              </button>
            );
          })}
        </div>

        <div className="cal__total">
          За {monthTitle(cursor.y, cursor.m).toLowerCase()}: <b>{formatRUB(Math.round(monthTotal))}</b>
        </div>
        {!isCurrentMonth && (
          <button className="link-all" style={{ display: 'block', margin: '6px auto 0' }} onClick={goToday}>
            Сегодня
          </button>
        )}
      </div>

      <div className="section-label">{formatDate(selected)}</div>
      {dayPayments.length === 0 ? (
        <div className="card center muted" style={{ padding: 18 }}>
          В этот день платежей нет
        </div>
      ) : (
        <div className="card">
          {dayPayments.map((p, i) => (
            <div
              key={p.kind + p.id + i}
              className="pay-row pay-row--tap"
              role="button"
              onClick={() => {
                tapLight();
                navigate(pathFor(p));
              }}
            >
              <span style={{ flex: 1 }}>{p.name}</span>
              <span style={{ fontWeight: 700 }}>{formatRUB(p.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}
