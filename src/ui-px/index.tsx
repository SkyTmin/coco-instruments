// Pixel UI kit — React components over the baked frames (`kit.gen.css`). Style guide:
// `.claude/rules/ui-px.md`. Game-only code: no imports from the instruments.
//
// Everything is sized in ART pixels (`--u`), uses the kit type (GxRubik text, Coco Title
// headings) and the shell's focus/input layer (`@/input`): focusable things carry `px-f`
// (a loud focus ring for keyboard and gamepad), key hints come from S's `<Prompt>`.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  PointerEvent as ReactPointerEvent,
  PropsWithChildren,
  ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { Prompt, useAction, useInputDevice } from '@/input';
import type { Action } from '@/input';
import { registerEscape } from '@/lib/escape-stack';
import { tapLight } from '@/lib/haptics';
import { uiClose, uiOpen } from '@/lib/sound';
import './ui-px.css';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---- Icon ------------------------------------------------------------------------------------

export type PxIconName =
  | 'x'
  | 'plus'
  | 'check'
  | 'lock'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'star'
  | 'heart'
  | 'paw'
  | 'sort'
  | 'filter'
  | 'play'
  | 'info'
  | 'sword'
  | 'bolt'
  | 'zzz'
  | 'pause'
  | 'paws'
  | 'claw'
  | 'moon'
  | 'coin'
  | 'token'
  | 'gem'
  | 'clock'
  | 'key'
  | 'egg'
  // wave 2 — N
  | 'grid'
  // wave 2 — C
  | 'gear'
  | 'sound'
  | 'mute'
  | 'music'
  | 'nomusic'
  | 'question'
  | 'excl'
  | 'minus'
  // wave 2 — K
  | 'auto'
  | 'buzz'
  | 'skip';

/** A 9×9 pixel icon (mask), colour = currentColor. */
export function Icon({ name, className }: { name: PxIconName; className?: string }) {
  return <i className={cx('px-i', `pxi-${name}`, className)} aria-hidden="true" />;
}

// ---- Panel -----------------------------------------------------------------------------------

export type Material = 'stone' | 'iron' | 'wood' | 'parch' | 'obsidian' | 'well';

/** A framed box of a material. `stage` — stone floor tile behind instead of a flat fill. */
export function Panel({
  material = 'obsidian',
  stage,
  tight,
  className,
  children,
  ...rest
}: PropsWithChildren<
  { material?: Material; stage?: boolean; tight?: boolean } & HTMLAttributes<HTMLDivElement>
>) {
  return (
    <div
      {...rest}
      className={cx(
        'px-panel',
        `px-panel--${material}`,
        `pxk-frame-${material}`,
        stage && 'px-stage pxt-stone px-nofill',
        tight && 'is-tight',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---- Press -----------------------------------------------------------------------------------
// The pressed look shows on POINTERDOWN, in the first frame. `:active` alone came late on touch
// (Android waits for its show-press delay, iOS WebKit needs a touch listener; on the stand it
// appeared 80–90 ms AFTER the finger was lifted). The class goes straight onto the element —
// no React render — and comes off on pointerup / pointercancel / leaving it / any scroll / blur.
// Style it as `.your-button.is-down` (no transition: the change must land in one frame).

const DOWN = 'is-down';
let downEl: HTMLElement | null = null;

function pressUp(): void {
  downEl?.classList.remove(DOWN);
  downEl = null;
  window.removeEventListener('pointerup', pressUp, true);
  window.removeEventListener('pointercancel', pressUp, true);
  window.removeEventListener('scroll', pressUp, true);
  window.removeEventListener('blur', pressUp);
}

function pressDown(e: ReactPointerEvent<HTMLElement>): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const el = e.currentTarget;
  // Greyed buttons stay flat (they only explain themselves), like `[aria-disabled]:active`.
  if (el.matches(':disabled, [aria-disabled="true"]')) return;
  pressUp();
  downEl = el;
  el.classList.add(DOWN);
  window.addEventListener('pointerup', pressUp, true);
  window.addEventListener('pointercancel', pressUp, true);
  window.addEventListener('scroll', pressUp, { capture: true, passive: true });
  window.addEventListener('blur', pressUp);
}

function pressLeave(e: ReactPointerEvent<HTMLElement>): void {
  if (e.currentTarget === downEl) pressUp();
}

export interface PressProps<T extends HTMLElement = HTMLElement> {
  onPointerDown: (e: ReactPointerEvent<T>) => void;
  onPointerLeave: (e: ReactPointerEvent<T>) => void;
}
const PRESS: PressProps = { onPointerDown: pressDown, onPointerLeave: pressLeave };

/** Visible press for any button (kit or not): spread the returned props on it and style
 *  `.is-down`. The handlers are stable (one pair for the whole app). Pass the element's `ref` if
 *  the component may re-render DURING a press with a new `className` (a slot that selects on
 *  focus): React rewrites `className` and would drop the class — the layout effect puts it back
 *  before the frame is painted. With handlers of your own, call `press.onPointerDown(e)` first. */
export function usePress<T extends HTMLElement = HTMLElement>(
  ref?: RefObject<T | null>,
): PressProps<T> {
  useLayoutEffect(() => {
    const el = ref?.current;
    if (el && el === downEl) el.classList.add(DOWN);
  });
  return PRESS as unknown as PressProps<T>;
}

// ---- Button ----------------------------------------------------------------------------------

export type ButtonKind = 'primary' | 'secondary' | 'danger' | 'confirm';
const BTN: Record<ButtonKind, string> = {
  primary: 'gold',
  secondary: 'iron',
  danger: 'red',
  confirm: 'green',
};

export type ButtonProps = {
  kind?: ButtonKind;
  size?: 'md' | 'sm';
  /** Square button with only an icon (`label` goes to aria-label and the hover tip). */
  icon?: PxIconName;
  label?: string;
  /** Pressed/selected toggle look. */
  on?: boolean;
  wide?: boolean;
  /** Greyed but still clickable (the tap explains why) — `aria-disabled`, not `disabled`. */
  off?: boolean;
  /** Key hint shown inside the button for keyboard/gamepad. */
  hint?: Action;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { children?: ReactNode };

export function Button({
  kind = 'secondary',
  size = 'md',
  icon,
  label,
  on,
  wide,
  off,
  hint,
  className,
  children,
  onClick,
  onPointerDown,
  onPointerLeave,
  ...rest
}: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const press = usePress(ref);
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      onPointerDown={(e) => {
        press.onPointerDown(e);
        onPointerDown?.(e);
      }}
      onPointerLeave={(e) => {
        press.onPointerLeave(e);
        onPointerLeave?.(e);
      }}
      aria-label={icon && !children ? label : rest['aria-label']}
      aria-pressed={on === undefined ? undefined : on}
      aria-disabled={off || undefined}
      data-tip={icon && !children ? label : (rest as { 'data-tip'?: string })['data-tip']}
      className={cx(
        'px-btn px-f',
        `px-btn--${BTN[kind]}`,
        size === 'sm' && 'px-btn--sm',
        icon && !children && 'px-btn--icon',
        wide && 'px-btn--wide',
        on && 'is-on',
        className,
      )}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      {children}
      {hint && <Prompt action={hint} className="px-keyhint" />}
    </button>
  );
}

// ---- Tabs ------------------------------------------------------------------------------------

export interface TabItem<K extends string> {
  id: K;
  label: ReactNode;
  icon?: PxIconName;
  /** A picture of its own instead of a kit icon (e.g. a game-icons `GxIcon`). */
  art?: ReactNode;
  /** Accessible name + mouse tip — for tabs whose label CSS may hide (icon-only strips). */
  name?: string;
  badge?: ReactNode;
}

/** Tabs with LB/RB (`tabPrev`/`tabNext`) for keyboard and gamepad. `vertical` — a rail (the
 *  selected tab joins the panel on its right). */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  className,
  keys = true,
  vertical,
  main,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (k: K) => void;
  className?: string;
  /** Listen to tabPrev/tabNext (only one tab row on screen should). */
  keys?: boolean;
  vertical?: boolean;
  /** wave 2 — C: the window's own tab row (the camp). A tab row inside the same window's
      content (PetsTab's «Питомцы / Яйца») then leaves tabPrev/tabNext to it — otherwise the inner
      row, registered later, eats LB/RB and the player is stuck on that tab. */
  main?: boolean;
}) {
  const scope = useRef<HTMLDivElement>(null);
  // Keyboard: Tab cycles (one hint on the right); gamepad: LB / RB on both sides.
  const pad = useInputDevice() === 'gamepad';
  useAction(
    ['tabPrev', 'tabNext'],
    (e) => {
      const el = scope.current;
      const owner = el?.closest('[data-ui-layer]')?.querySelector('.px-tabs[data-tabs-main]');
      if (owner && owner !== el) return false;
      const i = items.findIndex((x) => x.id === value);
      const n = (i + (e.action === 'tabNext' ? 1 : -1) + items.length) % items.length;
      onChange(items[n].id);
    },
    { enabled: keys && items.length > 1, scope },
  );
  return (
    <div
      ref={scope}
      className={cx('px-tabs', vertical && 'px-tabs--rail', className)}
      role="tablist"
      aria-orientation={vertical ? 'vertical' : undefined}
      data-tabs-main={main ? '' : undefined}
    >
      {keys && pad && items.length > 1 && <Prompt action="tabPrev" className="px-keyhint" />}
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={it.id === value}
          aria-label={it.name}
          data-tip={it.name}
          className="px-tab px-f"
          onClick={() => it.id !== value && onChange(it.id)}
        >
          {it.icon ? <Icon name={it.icon} /> : it.art}
          <span className="px-tab__label">{it.label}</span>
          {it.badge != null && it.badge !== false && <Badge>{it.badge}</Badge>}
        </button>
      ))}
      {keys && items.length > 1 && <Prompt action="tabNext" className="px-keyhint" />}
    </div>
  );
}

// ---- Badge, Bar, Heading, KeyHint ------------------------------------------------------------

export function Badge({ children, gold }: PropsWithChildren<{ gold?: boolean }>) {
  const dot = children === true || children === '•';
  return (
    <span className={cx('px-badge', gold && 'px-badge--gold', dot && 'px-badge--dot')}>
      {dot ? null : children}
    </span>
  );
}

export function Bar({
  value,
  tone = 'gold',
  label,
  height,
  className,
}: {
  value: number;
  tone?: 'gold' | 'blue' | 'green';
  label?: ReactNode;
  /** In art pixels (frame included); a labelled bar is tall enough for the small text. */
  height?: number;
  className?: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  const h = height ?? (label != null ? 10 : 6);
  return (
    <span
      className={cx('px-bar', tone !== 'gold' && `px-bar--${tone}`, className)}
      style={{ '--v': v, '--bh': h } as CSSProperties}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <i />
      {label != null && <span className="px-bar__label">{label}</span>}
    </span>
  );
}

export function Heading({
  children,
  ribbon,
  big,
  sub,
  className,
}: PropsWithChildren<{ ribbon?: boolean; big?: boolean; sub?: boolean; className?: string }>) {
  if (ribbon) return <div className={cx('px-ribbon', className)}>{children}</div>;
  return (
    <h3 className={cx('px-h', big && 'px-h--big', sub && 'px-h--sub', className)}>{children}</h3>
  );
}

/** S's prompt glyph for the current device in a pixel keycap; nothing on touch. */
export function KeyHint({ action, label }: { action: Action; label?: ReactNode }) {
  return <Prompt action={action} label={label} className="px-keyhint" />;
}

// ---- Slot ------------------------------------------------------------------------------------

export function Slot({
  rarity = 0,
  selected,
  locked,
  empty,
  count,
  corner,
  dot,
  tip,
  className,
  children,
  onPointerDown,
  onPointerLeave,
  ...rest
}: {
  rarity?: number;
  selected?: boolean;
  locked?: boolean;
  empty?: boolean;
  /** Bottom-right number (level, count). */
  count?: ReactNode;
  /** Top-left mark (gold star, «!»). */
  corner?: ReactNode;
  /** Red dot / badge on the corner («new», «can merge»). */
  dot?: ReactNode;
  /** Rich tooltip (mouse hover, long press on touch). A function is called only when the tip
   *  shows — a grid of slots doesn't build its tips on every render. */
  tip?: ReactNode | (() => ReactNode);
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { children?: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const tipState = useTip(ref, tip);
  const press = usePress(ref);
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      onPointerDown={(e) => {
        press.onPointerDown(e);
        onPointerDown?.(e);
      }}
      onPointerLeave={(e) => {
        press.onPointerLeave(e);
        onPointerLeave?.(e);
      }}
      className={cx(
        'px-slot px-f',
        `px-slot--r${Math.max(0, Math.min(6, rarity))}`,
        selected && 'is-sel',
        locked && 'is-locked',
        empty && 'is-empty',
        className,
      )}
      aria-pressed={selected}
    >
      <span className="px-slot__art">{children}</span>
      {locked && <Icon name="lock" className="px-slot__lock" />}
      {corner != null && <span className="px-slot__tl">{corner}</span>}
      {count != null && <span className="px-slot__n">{count}</span>}
      {dot != null && dot !== false && (
        <span className="px-slot__dot">
          <Badge>{dot}</Badge>
        </span>
      )}
      {tipState}
    </button>
  );
}

// ---- Tooltip ---------------------------------------------------------------------------------

/** Rich tooltip for `ref`: mouse hover (after 300 ms) or a long press on touch (450 ms, until
 *  release). Returns the portal to render. */
export function useTip(
  ref: RefObject<HTMLElement>,
  content: ReactNode | (() => ReactNode),
): ReactNode {
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  // Content is new JSX on every render — subscribe once per element, not per render (a
  // re-subscription hid the tip on each store tick).
  const has = content != null;
  useEffect(() => {
    const el = ref.current;
    if (!el || !has) return undefined;
    let timer = 0;
    const show = () => {
      const r = el.getBoundingClientRect();
      const below = r.top < window.innerHeight * 0.3;
      setPos({ x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
    };
    const hide = () => {
      window.clearTimeout(timer);
      setPos(null);
    };
    const enter = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      window.clearTimeout(timer);
      timer = window.setTimeout(show, 300);
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return hide();
      window.clearTimeout(timer);
      timer = window.setTimeout(show, 450);
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', hide);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', hide);
    el.addEventListener('pointercancel', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      hide();
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', hide);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', hide);
      el.removeEventListener('pointercancel', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [ref, has]);
  if (!pos || !has) return null;
  return createPortal(
    <Tooltip {...pos}>{typeof content === 'function' ? content() : content}</Tooltip>,
    document.body,
  );
}

export function Tooltip({
  x,
  y,
  below,
  children,
}: PropsWithChildren<{ x: number; y: number; below?: boolean }>) {
  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const pad = 6;
    if (r.left < pad) setDx(pad - r.left);
    else if (r.right > window.innerWidth - pad) setDx(window.innerWidth - pad - r.right);
  }, [x, y]);
  return (
    <div
      ref={ref}
      className={cx('px px-tip', below && 'is-below')}
      style={{ left: x + dx, top: y }}
      role="tooltip"
    >
      {children}
    </div>
  );
}

// ---- Inspect ---------------------------------------------------------------------------------

/** Big detail card: name in the rarity colour, a sub line, then rows/content. */
export function Inspect({
  name,
  sub,
  color,
  className,
  children,
}: PropsWithChildren<{ name: ReactNode; sub?: ReactNode; color?: string; className?: string }>) {
  return (
    <div className={cx('px-inspect', className)} style={{ '--rc': color } as CSSProperties}>
      <div className="px-inspect__head">
        <div className="px-inspect__name">{name}</div>
        {sub != null && <div className="px-inspect__sub">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export function InspectRow({ k, children }: PropsWithChildren<{ k: ReactNode }>) {
  return (
    <div className="px-inspect__row">
      <span>{k}</span>
      <span>{children}</span>
    </div>
  );
}

// ---- Grid ------------------------------------------------------------------------------------

/** Equal cells; arrows/d-pad move focus between them (the shell's focus navigation). */
export function Grid({
  cols,
  slot,
  className,
  children,
  ...rest
}: PropsWithChildren<{ cols?: number; slot?: number } & HTMLAttributes<HTMLDivElement>>) {
  const style = {
    ...(cols ? { '--cols': cols } : {}),
    ...(slot ? { '--slot': `calc(${slot} * var(--u))` } : {}),
    ...rest.style,
  } as CSSProperties;
  return (
    <div {...rest} className={cx('px-grid', className)} style={style} role="group">
      {children}
    </div>
  );
}

// ---- Modal / Sheet ---------------------------------------------------------------------------

/** Window over everything: wood frame, ribbon title, close button; Esc/Back/B closes it
 *  (escape stack, same as GxModal). `sheet` — docked to the bottom on phones in portrait. */
export function Modal({
  title,
  onClose,
  sheet,
  width,
  className,
  children,
}: PropsWithChildren<{
  title?: ReactNode;
  onClose: () => void;
  sheet?: boolean;
  /** Max width in art pixels. */
  width?: number;
  className?: string;
}>) {
  const t = useT();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    uiOpen();
    const off = registerEscape(() => closeRef.current());
    return () => {
      off();
      uiClose();
    };
  }, []);
  return createPortal(
    <div className={cx('px px-veil', sheet && 'px-veil--sheet')} data-ui-layer="" onClick={onClose}>
      <div
        className={cx('px-modal', className)}
        style={width ? ({ '--mw': width } as CSSProperties) : undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {title != null && (
          <div className="px-ribbon px-modal__title">
            <span>{title}</span>
          </div>
        )}
        <Button
          kind="danger"
          size="sm"
          icon="x"
          label={t('common.close')}
          className="px-modal__close"
          onClick={() => {
            tapLight();
            onClose();
          }}
        />
        <div className="px-modal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
