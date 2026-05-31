import { useEffect, useRef, useState } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { useNavigationType } from 'react-router-dom';
import type { ExpenseType } from '@/types';
import { formatRUB } from '@/lib/format';
import { IconChevron, IconPlus } from '@/components/icons';
import { selectionChanged } from '@/lib/haptics';

export const LEAD_OPTIONS: { v: number; label: string }[] = [
  { v: 0, label: 'в день' },
  { v: 1, label: 'за день' },
  { v: 2, label: 'за 2 дня' },
  { v: 3, label: 'за 3 дня' },
  { v: 7, label: 'за неделю' },
];

/** Multi-select chips for choosing which lead-days to remind on. */
export function LeadPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const toggle = (v: number) => {
    selectionChanged();
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v].sort((a, b) => a - b));
  };
  return (
    <div className="chips">
      {LEAD_OPTIONS.map((o) => (
        <button
          key={o.v}
          type="button"
          className={`chip${value.includes(o.v) ? ' is-active' : ''}`}
          onClick={() => toggle(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Screen({
  title,
  subtitle,
  action,
  children,
}: PropsWithChildren<{ title?: string; subtitle?: string; action?: ReactNode }>) {
  // Going "back" (POP) slides in from the left, forward (PUSH) from the right —
  // a native push/pop feel. The slide is tiny + clipped, so it never scrolls.
  const dir = useNavigationType() === 'POP' ? 'pop' : 'push';
  return (
    <div className={`screen screen--${dir}`}>
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

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Counts a number up to its target on mount (and re-animates on change) —
 * the fintech "ticker" feel. Falls back to the final value when the user
 * prefers reduced motion.
 */
export function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  duration = 700,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(prefersReducedMotion() ? value : 0);
  const fromRef = useRef(prefersReducedMotion() ? value : 0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <>{format(display)}</>;
}

export function Money({ value, precise }: { value: number; precise?: boolean }) {
  return <>{formatRUB(value, precise)}</>;
}

/** An SVG progress ring whose arc animates in on mount. */
export function ProgressRing({
  percent,
  size = 108,
  stroke = 11,
  children,
}: PropsWithChildren<{ percent: number; size?: number; stroke?: number }>) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const reduce = prefersReducedMotion();
  const [shown, setShown] = useState(reduce ? clamped : 0);

  useEffect(() => {
    if (reduce) {
      setShown(clamped);
      return;
    }
    const id = requestAnimationFrame(() => setShown(clamped));
    return () => cancelAnimationFrame(id);
  }, [clamped, reduce]);

  const center = size / 2;
  const offset = circ * (1 - shown / 100);
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent-grad-1)" />
            <stop offset="100%" stopColor="var(--accent-grad-2)" />
          </linearGradient>
        </defs>
        <circle className="ring__track" cx={center} cy={center} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="ring__fill"
          cx={center}
          cy={center}
          r={r}
          strokeWidth={stroke}
          fill="none"
          stroke="url(#ringGrad)"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <div className="ring__center">{children}</div>
    </div>
  );
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

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <span className="section-label" style={{ margin: 0 }}>
        {title}
      </span>
      {action}
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
