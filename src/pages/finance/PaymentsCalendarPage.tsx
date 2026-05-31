import { useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatedNumber, Screen } from '@/components/ui';
import { useFinanceStore } from '@/store';
import { collectPayments, type CalendarPayment } from '@/lib/finance-calc';
import { toISO, todayISO } from '@/lib/date';
import { formatDate, formatRUB, relativeDay } from '@/lib/format';
import { selectionChanged, tapLight } from '@/lib/haptics';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

type Tag = CalendarPayment['tag'];
const TAG_DOT: Record<Tag, string> = {
  single: 'var(--pos)',
  credit: 'var(--neg)',
  installment: 'var(--warn)',
  recurring: '#6e8efb',
};
const TAG_BADGE: Record<Tag, { label: string; cls: string }> = {
  single: { label: 'Разовый', cls: 'badge--single' },
  credit: { label: 'Кредит', cls: 'badge--credit' },
  installment: { label: 'Рассрочка', cls: 'badge--installment' },
  recurring: { label: 'Регулярный', cls: 'badge--recurring' },
};

const pathFor = (p: CalendarPayment) =>
  p.kind === 'recurring' ? `/finance/recurring/${p.id}` : `/finance/expenses/${p.id}`;

function monthTitle(y: number, m: number): string {
  const s = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(y, m, 1));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dayTags(payments: CalendarPayment[]): Tag[] {
  const seen: Tag[] = [];
  for (const p of payments) if (!seen.includes(p.tag)) seen.push(p.tag);
  return seen.slice(0, 3);
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
  const [anim, setAnim] = useState<'next' | 'prev' | null>(null);
  const [drag, setDrag] = useState(0);

  const swipeRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<{ x: number; y: number; decided: boolean; horizontal: boolean; pid: number } | null>(null);
  const swipedRef = useRef(false);

  const { byDay, monthTotal, monthCount, cells } = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const offset = (first.getDay() + 6) % 7;
    const gridStart = new Date(cursor.y, cursor.m, 1 - offset);
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });

    const gridStartISO = toISO(cells[0]);
    const gridEndISO = toISO(cells[41]);
    const rangeStart = gridStartISO < today ? today : gridStartISO;
    const payments = collectPayments(rangeStart, gridEndISO, expenses, recurring, listId);

    const byDay = new Map<string, CalendarPayment[]>();
    const mStart = toISO(new Date(cursor.y, cursor.m, 1));
    const mEnd = toISO(new Date(cursor.y, cursor.m + 1, 0));
    let monthTotal = 0;
    let monthCount = 0;
    for (const p of payments) {
      const arr = byDay.get(p.date) ?? [];
      arr.push(p);
      byDay.set(p.date, arr);
      if (p.date >= mStart && p.date <= mEnd) {
        monthTotal += p.amount;
        monthCount += 1;
      }
    }
    return { byDay, monthTotal, monthCount, cells };
  }, [cursor, expenses, recurring, listId, today]);

  const shift = (delta: number) => {
    tapLight();
    setAnim(delta > 0 ? 'next' : 'prev');
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const pickDay = (d: Date) => {
    if (swipedRef.current) return;
    selectionChanged();
    setSelected(toISO(d));
    if (d.getMonth() !== cursor.m || d.getFullYear() !== cursor.y) {
      setAnim(d > new Date(cursor.y, cursor.m, 1) ? 'next' : 'prev');
      setCursor({ y: d.getFullYear(), m: d.getMonth() });
    }
  };

  const goToday = () => {
    tapLight();
    setAnim(now > new Date(cursor.y, cursor.m, 1) ? 'next' : 'prev');
    setCursor({ y: now.getFullYear(), m: now.getMonth() });
    setSelected(today);
  };

  // ---- swipe between months -------------------------------------------------
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    gesture.current = { x: e.clientX, y: e.clientY, decided: false, horizontal: false, pid: e.pointerId };
    swipedRef.current = false;
    setAnim(null);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.decided && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      g.decided = true;
      g.horizontal = Math.abs(dx) > Math.abs(dy);
      if (g.horizontal) swipeRef.current?.setPointerCapture(g.pid);
    }
    if (g.decided && g.horizontal) {
      e.preventDefault();
      setDrag(dx * 0.85);
    }
  };
  const endGesture = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (g && g.horizontal) {
      const dx = e.clientX - g.x;
      swipedRef.current = true;
      window.setTimeout(() => (swipedRef.current = false), 80);
      setDrag(0);
      if (Math.abs(dx) > 52) shift(dx < 0 ? 1 : -1);
      return;
    }
    setDrag(0);
  };

  const isCurrentMonth = cursor.y === now.getFullYear() && cursor.m === now.getMonth();
  const dayPayments = byDay.get(selected) ?? [];
  const dayTotal = dayPayments.reduce((s, p) => s + p.amount, 0);
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

        <div
          className="cal__swipe"
          ref={swipeRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        >
          <div
            key={`${cursor.y}-${cursor.m}`}
            className={`cal__grid${anim ? ` cal__grid--${anim}` : ''}`}
            style={{ transform: drag ? `translateX(${drag}px)` : undefined, transition: drag ? 'none' : undefined }}
          >
            {cells.map((d) => {
              const iso = toISO(d);
              const inMonth = d.getMonth() === cursor.m;
              const tags = byDay.has(iso) ? dayTags(byDay.get(iso)!) : [];
              return (
                <button
                  key={iso}
                  className={`cal__day${inMonth ? '' : ' is-out'}${iso === selected ? ' is-sel' : ''}${
                    iso === today ? ' is-today' : ''
                  }${tags.length ? ' has-pay' : ''}`}
                  onClick={() => pickDay(d)}
                >
                  <span>{d.getDate()}</span>
                  {tags.length > 0 && (
                    <span className="cal__dots">
                      {tags.map((t) => (
                        <i key={t} style={{ background: TAG_DOT[t] }} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="cal__summary">
          <span>
            {monthCount > 0 ? `${monthCount} ${monthCount === 1 ? 'платёж' : 'платежей'}` : 'Нет платежей'}
          </span>
          <b>
            <AnimatedNumber value={Math.round(monthTotal)} format={formatRUB} />
          </b>
        </div>
        {!isCurrentMonth && (
          <button className="cal__today" onClick={goToday}>
            Сегодня
          </button>
        )}
      </div>

      <div className="cal-detail-head">
        <div className="section-label" style={{ margin: 0 }}>
          {formatDate(selected)}
        </div>
        <span className="cal-detail-rel">{relativeDay(selected)}</span>
      </div>

      {dayPayments.length === 0 ? (
        <div className="card center muted" style={{ padding: 18 }}>
          В этот день платежей нет
        </div>
      ) : (
        <div className="stack">
          {dayPayments.map((p, i) => (
            <div
              key={p.kind + p.id + i}
              className="cal-pay"
              role="button"
              style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
              onClick={() => {
                tapLight();
                navigate(pathFor(p));
              }}
            >
              <span className="cal-pay__dot" style={{ background: TAG_DOT[p.tag] }} />
              <div className="cal-pay__body">
                <div className="cal-pay__name">{p.name}</div>
                <span className={`badge ${TAG_BADGE[p.tag].cls}`}>{TAG_BADGE[p.tag].label}</span>
              </div>
              <div className="cal-pay__amount">{formatRUB(p.amount)}</div>
            </div>
          ))}
          {dayPayments.length > 1 && (
            <div className="cal-day-total">
              Итого за день: <b>{formatRUB(Math.round(dayTotal))}</b>
            </div>
          )}
        </div>
      )}
    </Screen>
  );
}
