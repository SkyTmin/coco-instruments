import { useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  PropsWithChildren,
  ReactNode,
} from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import type { ExpenseType } from '@/types';
import { formatRUB } from '@/lib/format';
import { IconBack, IconChevron, IconPlus } from '@/components/icons';
import { registerEscape, closeTopOverlay } from '@/lib/escape-stack';
import { isWebMode } from '@/lib/runtime';
import { tapLight } from '@/lib/haptics';
import { selectionChanged } from '@/lib/haptics';

export const LEAD_OPTIONS: { v: number; label: string }[] = [
  { v: 0, label: 'в день' },
  { v: 1, label: 'за день' },
  { v: 2, label: 'за 2 дня' },
  { v: 3, label: 'за 3 дня' },
  { v: 7, label: 'за неделю' },
];

/** Multi-select chips for choosing which lead-days to remind on. */
export function LeadPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const toggle = (v: number) => {
    selectionChanged();
    onChange(
      value.includes(v) ? value.filter((x) => x !== v) : [...value, v].sort((a, b) => a - b),
    );
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
  className,
  children,
}: PropsWithChildren<{
  title?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}>) {
  // Going "back" (POP) slides in from the left, forward (PUSH) from the right —
  // a native push/pop feel. The slide is tiny + clipped, so it never scrolls.
  const dir = useNavigationType() === 'POP' ? 'pop' : 'push';
  const location = useLocation();
  const navigate = useNavigate();
  // The website has no Telegram back bar — render our own in the header (left of
  // the title, so it never covers the logo/title). Hidden on home and in the
  // Mini App (Telegram provides its own back button there).
  const showBack = isWebMode() && location.pathname !== '/';
  const goBack = () => {
    tapLight();
    if (closeTopOverlay()) return; // close an open sheet/menu first
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };
  return (
    <div className={`screen screen--${dir}${className ? ` ${className}` : ''}`}>
      {(title || action || showBack) && (
        <div className="screen__head">
          <div className="row">
            {showBack && (
              <button className="screen__back" type="button" onClick={goBack} aria-label="Назад">
                <IconBack size={22} />
              </button>
            )}
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

/** Shimmering placeholder block shown while data hydrates. */
export function Skeleton({
  width = '100%',
  height = 16,
  radius = 10,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />;
}

interface SwipeAction {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/**
 * A row that reveals action buttons (Edit / Delete) when swiped left, and
 * fires `onTap` on a plain tap. Vertical drags fall through to page scroll.
 */
export function SwipeRow({
  children,
  actions,
  onTap,
}: PropsWithChildren<{ actions: SwipeAction[]; onTap?: () => void }>) {
  const width = actions.length * 76;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const openRef = useRef(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const g = useRef<{
    x: number;
    y: number;
    base: number;
    decided: boolean;
    hz: boolean;
    pid: number;
  } | null>(null);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    g.current = {
      x: e.clientX,
      y: e.clientY,
      base: offset,
      decided: false,
      hz: false,
      pid: e.pointerId,
    };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      s.decided = true;
      s.hz = Math.abs(dx) > Math.abs(dy);
      if (s.hz) {
        ref.current?.setPointerCapture(s.pid);
        setDragging(true);
      }
    }
    if (s.decided && s.hz) {
      e.preventDefault();
      setOffset(Math.max(-width, Math.min(0, s.base + dx)));
    }
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    g.current = null;
    if (!s) return;
    if (s.hz) {
      setDragging(false);
      const cur = Math.max(-width, Math.min(0, s.base + (e.clientX - s.x)));
      const open = cur < -width / 2;
      setOffset(open ? -width : 0);
      openRef.current = open;
      if (open) selectionChanged();
      return;
    }
    if (s.decided) return; // vertical scroll — ignore
    if (openRef.current) {
      setOffset(0);
      openRef.current = false;
    } else {
      onTap?.();
    }
  };
  const cancel = () => {
    g.current = null;
    setDragging(false);
    setOffset(openRef.current ? -width : 0);
  };

  return (
    <div
      ref={ref}
      className={`swipe${offset < -2 ? ' is-open' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
    >
      <div className="swipe__actions" style={{ width }}>
        {actions.map((a, i) => (
          <button
            key={i}
            className={`swipe__act${a.danger ? ' swipe__act--danger' : ''}`}
            aria-label={a.label}
            onClick={(e) => {
              e.stopPropagation();
              setOffset(0);
              openRef.current = false;
              a.onClick();
            }}
          >
            {a.icon}
          </button>
        ))}
      </div>
      <div
        className="swipe__front"
        style={{ transform: `translateX(${offset}px)`, transition: dragging ? 'none' : undefined }}
      >
        {children}
      </div>
    </div>
  );
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
        <circle
          className="ring__track"
          cx={center}
          cy={center}
          r={r}
          strokeWidth={stroke}
          fill="none"
        />
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
      <div
        className="progress__fill"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
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
      tabIndex={onClick ? 0 : undefined}
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

export function EmptyState({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
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
    <div className="section-card" onClick={onClick} role="button" tabIndex={0}>
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
  // Esc closes the topmost sheet (see escape-stack); ref keeps the handler fresh.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => registerEscape(() => closeRef.current()), []);
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
