import type { PropsWithChildren, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ExpenseType } from '@/types';
import { formatRUB } from '@/lib/format';
import { IconBack, IconChevron, IconPlus } from '@/components/icons';
import { tapLight } from '@/lib/haptics';

export function Screen({
  title,
  subtitle,
  action,
  back = true,
  children,
}: PropsWithChildren<{ title?: string; subtitle?: string; action?: ReactNode; back?: boolean }>) {
  const navigate = useNavigate();
  return (
    <div className="screen">
      {back && (
        <button
          className="back-bar"
          onClick={() => {
            tapLight();
            navigate(-1);
          }}
        >
          <IconBack size={18} />
          Назад
        </button>
      )}
      {(title || action) && (
        <div className="screen__head">
          <div className="row">
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && <h1 className="page-title">{title}</h1>}
              {subtitle && <p className="page-sub">{subtitle}</p>}
            </div>
            {action}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

export function Money({ value, precise }: { value: number; precise?: boolean }) {
  return <>{formatRUB(value, precise)}</>;
}

export function ProgressBar({ percent, large }: { percent: number; large?: boolean }) {
  return (
    <div className={`progress${large ? ' progress--lg' : ''}`}>
      <div className="progress__fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

export function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat-row">
      <span className="stat-row__label">{label}</span>
      <span className="stat-row__value">{value}</span>
    </div>
  );
}

export function StatTile({
  label,
  value,
  onClick,
}: {
  label: string;
  value: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className={`stat-tile${onClick ? ' stat-tile--tap' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="stat-tile__label">
        {label}
        {onClick && <span className="stat-tile__more">›</span>}
      </div>
      <div className="stat-tile__value">{value}</div>
    </div>
  );
}

const TYPE_BADGE: Record<ExpenseType, { label: string; cls: string }> = {
  single: { label: 'Разовый', cls: 'badge--single' },
  credit: { label: 'Кредит', cls: 'badge--credit' },
  installment: { label: 'Рассрочка', cls: 'badge--installment' },
};

export function TypeBadge({ type }: { type: ExpenseType }) {
  const b = TYPE_BADGE[type];
  return <span className={`badge ${b.cls}`}>{b.label}</span>;
}

export function EmptyState({
  icon,
  title,
  sub,
}: {
  icon: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <div className="empty__title">{title}</div>
      {sub && <div className="empty__sub">{sub}</div>}
    </div>
  );
}

export function Fab({ onClick }: { onClick: () => void }) {
  return (
    <button className="fab" onClick={onClick} aria-label="Добавить">
      <IconPlus />
    </button>
  );
}

export function SectionCard({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <div className="section-card" onClick={onClick} role="button">
      <div className="section-card__icon">{icon}</div>
      <div className="section-card__body">
        <div className="section-card__title">{title}</div>
        {sub && <div className="section-card__sub">{sub}</div>}
      </div>
      <IconChevron className="chev" size={20} />
    </div>
  );
}

export function Sheet({
  title,
  onClose,
  children,
}: PropsWithChildren<{ title?: string; onClose: () => void }>) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__handle" />
        {title && <h3 className="sheet__title">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title = 'Удалить?',
  message,
  confirmLabel = 'Удалить',
  onConfirm,
  onClose,
}: {
  title?: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="muted" style={{ marginTop: -4, marginBottom: 16 }}>
        {message}
      </p>
      <div className="stack">
        <button className="btn btn--danger btn--block" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button className="btn btn--ghost btn--block" onClick={onClose}>
          Отмена
        </button>
      </div>
    </Sheet>
  );
}
