import { ProgressBar, TypeBadge } from '@/components/ui';
import type { Obligation, RecurringPayment } from '@/types';
import { computeObligation, computeRecurring } from '@/lib/finance-calc';
import { formatDate, formatRUB, intervalLabel } from '@/lib/format';

/** A finite obligation row (single / credit / installment). */
export function ObligationMiniCard({
  o,
  onClick,
  tag,
}: {
  o: Obligation;
  onClick: () => void;
  tag?: string;
}) {
  const c = computeObligation(o);
  const closed = o.status === 'closed';
  return (
    <div className="obl-card" onClick={onClick} role="button">
      <div className="obl-card__top">
        <span className="obl-card__name">{o.name}</span>
        {closed ? <span className="badge badge--closed">Закрыт</span> : <TypeBadge type={o.type} />}
      </div>
      <div className="obl-card__nums">
        <span className="obl-card__remain">{closed ? 'Выплачено' : formatRUB(c.remaining)}</span>
        <span className="obl-card__total">из {formatRUB(c.totalToPay)}</span>
      </div>
      <ProgressBar percent={c.progressPercent} />
      {tag && <div className="list-tag">📂 {tag}</div>}
    </div>
  );
}

/** A recurring payment row (subscription / rent / …). */
export function RecurringMiniCard({
  r,
  onClick,
  tag,
}: {
  r: RecurringPayment;
  onClick: () => void;
  tag?: string;
}) {
  const c = computeRecurring(r);
  return (
    <div className="obl-card" onClick={onClick} role="button">
      <div className="obl-card__top">
        <span className="obl-card__name">{r.name}</span>
        {r.paused ? (
          <span className="badge badge--closed">Пауза</span>
        ) : (
          <span className="badge badge--installment">{intervalLabel(r.intervalCount, r.intervalUnit)}</span>
        )}
      </div>
      <div className="obl-card__nums">
        <span className="obl-card__remain">{formatRUB(r.amount)}</span>
        <span className="obl-card__total">
          {r.paused ? 'на паузе' : `далее ${formatDate(c.nextDue, true)}`}
        </span>
      </div>
      <div className="rec-card__hint">≈ {formatRUB(Math.round(c.monthlyEquivalent))} в месяц</div>
      {tag && <div className="list-tag">📂 {tag}</div>}
    </div>
  );
}
