// Casino frame (UI wave 2 — K): the pieces Slots and Cascade share around their skin cabinet —
// the fit-to-box scaler, the control deck (balance, bet −/+, Spin, auto, turbo) and the info
// cells. The cabinet itself (reels, grid, lever, skins) is untouched: it is drawn at its old
// fixed pixel size and scaled as one piece, because the reel motion moves in those pixels.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { Button, Icon, KeyHint } from '@/ui-px';
import type { PxIconName } from '@/ui-px';
import { useAction } from '@/input/hooks';
import { useFormFactor } from '@/game-shell';
import { inTopLayer } from '@/input/focus-nav';
import { CoinIcon } from '@/components/slot-art';
import { BETS } from '@/lib/slots';
import { selectionChanged, tapLight } from '@/lib/haptics';
import { fmtNum, useT } from '@/i18n';
import './casino.css';

/**
 * Scale of the cabinet so it fills the stage box. Natural size = the cabinet's own layout box
 * (`offsetWidth/Height` ignore the `scale` property, so there is no feedback loop); the box is a
 * size container whose content is absolutely placed. Floors to 1 % so a sub-pixel resize does
 * not re-render the page.
 */
export function useFit(
  box: RefObject<HTMLElement>,
  item: RefObject<HTMLElement>,
  max = 3,
): { k: number; w: number; h: number } {
  const [fit, setFit] = useState({ k: 0, w: 0, h: 0 });
  useLayoutEffect(() => {
    const b = box.current;
    const it = item.current;
    if (!b || !it) return undefined;
    const measure = () => {
      const w = it.offsetWidth;
      const h = it.offsetHeight;
      const bw = b.clientWidth;
      const bh = b.clientHeight;
      if (!w || !h || !bw || !bh) return;
      const k = Math.floor(Math.max(0.4, Math.min(max, bw / w, bh / h)) * 100) / 100;
      setFit((f) => (f.k === k && f.w === w && f.h === h ? f : { k, w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    ro.observe(it);
    return () => ro.disconnect();
  }, [box, item, max]);
  return fit;
}

/** Style for the fit wrapper and the scaled cabinet. Hidden until measured (no flash at 1×). */
export function fitStyles(fit: { k: number; w: number; h: number }): {
  wrap: CSSProperties;
  item: CSSProperties;
} {
  if (!fit.k) return { wrap: { visibility: 'hidden' }, item: {} };
  // The cabinet keeps its centre on the wrapper's centre: the shake (juice.ts) rotates it
  // around `transform-origin: center`, and `scale` composes with that transform.
  return {
    wrap: { width: Math.round(fit.w * fit.k), height: Math.round(fit.h * fit.k) },
    item: {
      scale: String(fit.k),
      marginLeft: -fit.w / 2,
      marginTop: -fit.h / 2,
    } as CSSProperties,
  };
}

/**
 * Page layout: «tall» = info strip, stage, deck in one column (phone portrait and tablet
 * portrait — there the width is the limit, so the stage gets all the height left); «wide» =
 * info | stage | deck columns (phone landscape, tablet landscape, desktop).
 */
export function useCasLayout(): 'tall' | 'wide' {
  const { ff, landscape } = useFormFactor();
  return ff === 'phone-portrait' || (ff === 'tablet' && !landscape) ? 'tall' : 'wide';
}

/** One fact: icon + number (+ a small word under it on roomy formats). */
export function CasStat({
  icon,
  value,
  label,
  tone,
  className,
}: {
  icon: ReactNode;
  value: ReactNode;
  label: ReactNode;
  tone?: 'gold';
  className?: string;
}) {
  return (
    <div
      className={`cas-stat${tone ? ` cas-stat--${tone}` : ''}${className ? ` ${className}` : ''}`}
    >
      <span className="cas-stat__ico">{icon}</span>
      <b className="cas-stat__v px-num">{value}</b>
      <i className="cas-stat__k">{label}</i>
    </div>
  );
}

/** Kit icon as a node (for `CasStat`). */
export const KitIcon = ({ name }: { name: PxIconName }) => <Icon name={name} />;

const prevBet = (bet: number) => [...BETS].reverse().find((b) => b < bet);
const nextBet = (bet: number) => BETS.find((b) => b > bet);

export interface DeckProps {
  /** The page's balance counter (its ref is driven by the roll-up). */
  balance: ReactNode;
  balanceNum: number;
  bet: number;
  /** Shown as the stake on the spin plate (Cascade: bet × ante). */
  freeSpins: number;
  spinning: boolean;
  setBet: (b: number) => void;
  onCustomBet: () => void;
  spinLabel: ReactNode;
  spinDisabled: boolean;
  busy: boolean;
  onSpin: () => void;
  auto: number;
  autoDisabled: boolean;
  onAuto: () => void;
  turbo: boolean;
  onTurbo: () => void;
  /** Cascade: ante + buy bonus. */
  extra?: ReactNode;
}

/**
 * The control deck — the thumb zone on phones, the right column elsewhere. Bet −/+ walk the
 * same quick bets the old chips offered (a tap on the bet opens the custom-bet sheet, as «⋯»
 * did); the chips themselves stay on roomy formats. Keys: Space/Enter (page) and pad A spin,
 * Tab / Shift+Tab, LB / RB, ←/→ (nothing focused) and −/+ change the bet, X / pad Y = auto.
 */
export function CasDeck(p: DeckProps) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const pv = prevBet(p.bet);
  const nx = nextBet(p.bet);
  const canLess = !p.spinning && pv !== undefined;
  const canMore = !p.spinning && nx !== undefined && nx <= p.balanceNum;

  const step = (dir: -1 | 1) => {
    const b = dir < 0 ? pv : nx;
    if (dir < 0 ? !canLess : !canMore) return;
    if (b === undefined) return;
    selectionChanged();
    p.setBet(b);
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  useAction('tabPrev', () => stepRef.current(-1), { scope: root });
  useAction('tabNext', () => stepRef.current(1), { scope: root });
  useAction(
    ['left', 'right'],
    (e) => {
      const a = document.activeElement;
      if (a && a !== document.body) return false;
      stepRef.current(e.action === 'left' ? -1 : 1);
      return true;
    },
    { scope: root },
  );
  useAction(
    'inspect',
    () => {
      if (p.autoDisabled) return false;
      p.onAuto();
      return true;
    },
    { scope: root },
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && e.code !== 'Minus' && e.code !== 'Equal') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!inTopLayer(root.current)) return;
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') stepRef.current(-1);
      else if (e.code === 'Equal' || e.code === 'NumpadAdd') stepRef.current(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const autoOn = p.auto > 0;
  return (
    <div className="cas-deck px" ref={root}>
      {p.extra && <div className="cas-deck__extra">{p.extra}</div>}
      <div className="cas-deck__money">
        <div className="cas-bal">
          <i className="cas-cap">{t('slots.hud.balance')}</i>
          <span className="cas-bal__v px-num">{p.balance}</span>
        </div>
        <div className="cas-bet">
          <i className="cas-cap">{t('slots.hud.betLabel')}</i>
          <div className="cas-bet__row">
            <Button
              size="sm"
              icon="minus"
              label={t('slots.bet.less')}
              off={!canLess}
              onClick={() => step(-1)}
              className="cas-bet__step"
            />
            <button
              type="button"
              className="cas-bet__v cas-well px-f px-num"
              disabled={p.spinning}
              aria-label={t('slots.a11y.bet')}
              data-tip={t('slots.a11y.bet')}
              onClick={() => {
                tapLight();
                p.onCustomBet();
              }}
            >
              {fmtNum(p.bet)}
              <CoinIcon size={18} />
            </button>
            <Button
              size="sm"
              icon="plus"
              label={t('slots.bet.more')}
              off={!canMore}
              onClick={() => step(1)}
              className="cas-bet__step"
            />
          </div>
          <div className="cas-bet__keys" aria-hidden="true">
            <KeyHint action="tabPrev" />
            <KeyHint action="tabNext" />
          </div>
        </div>
      </div>
      <div className="cas-chips" role="group" aria-label={t('slots.hud.betLabel')}>
        {BETS.map((b) => (
          <Button
            key={b}
            size="sm"
            on={b === p.bet}
            off={p.spinning || b > p.balanceNum}
            onClick={() => {
              if (p.spinning || b > p.balanceNum) return;
              selectionChanged();
              p.setBet(b);
            }}
            className="cas-chip px-num"
          >
            {fmtNum(b)}
          </Button>
        ))}
      </div>
      <div className="cas-deck__go">
        <Button
          icon="auto"
          label={autoOn ? t('slots.a11y.autoStop') : t('slots.a11y.auto')}
          aria-label={autoOn ? t('slots.a11y.autoStop') : t('slots.a11y.auto')}
          data-tip={autoOn ? t('slots.a11y.autoStop') : t('slots.a11y.auto')}
          on={autoOn}
          off={p.autoDisabled}
          hint="inspect"
          onClick={() => {
            if (p.autoDisabled) return;
            p.onAuto();
          }}
          className="cas-mini"
        >
          {autoOn && <b className="cas-mini__n px-num">{p.auto === Infinity ? '∞' : p.auto}</b>}
        </Button>
        <Button
          kind={autoOn ? 'danger' : 'primary'}
          className={`cas-spin${p.busy ? ' is-busy' : ''}`}
          off={p.spinDisabled}
          hint="confirm"
          data-autofocus=""
          onClick={() => {
            if (p.spinDisabled) return;
            p.onSpin();
          }}
        >
          <span className="cas-spin__t">{p.spinLabel}</span>
        </Button>
        <Button
          icon="bolt"
          label={t('slots.a11y.turbo')}
          on={p.turbo}
          onClick={p.onTurbo}
          className="cas-mini"
        />
      </div>
    </div>
  );
}

// ---- Sheet bodies shared by both games (the sheets themselves and their handlers stay in the
// pages): settings toggles, auto-spin options, the bet picker.

export interface CasToggleItem {
  key: string;
  on: boolean;
  icon: PxIconName;
  name: string;
  hint: string;
  onClick: () => void;
}

/** Settings rows: icon, name + hint, a kit check box at the right edge. */
export function CasToggles({ items }: { items: CasToggleItem[] }) {
  return (
    <div className="cas-toggles px">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`cas-toggle px-f${it.on ? ' is-on' : ''}`}
          aria-pressed={it.on}
          onClick={it.onClick}
        >
          <span className="cas-toggle__ico">
            <Icon name={it.icon} />
          </span>
          <span className="cas-toggle__text">
            <b>{it.name}</b>
            <i>{it.hint}</i>
          </span>
          <span className="cas-toggle__box cas-well" aria-hidden="true">
            {it.on && <Icon name="check" />}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Auto-spin choices: a big number and what it is for. */
export function CasAutoPicker<H extends string>({
  options,
  hint,
  onPick,
  note,
}: {
  options: { value: number; label: string; hint: H }[];
  hint: (h: H) => string;
  onPick: (value: number) => void;
  note?: ReactNode;
}) {
  return (
    <div className="cas-autos px">
      <div className="cas-autos__grid">
        {options.map((o, i) => (
          <Button
            key={o.label}
            kind={o.value === Infinity ? 'primary' : 'secondary'}
            className="cas-autos__opt"
            data-autofocus={i === 0 ? '' : undefined}
            onClick={() => onPick(o.value)}
          >
            <b className="cas-autos__n px-num">{o.label}</b>
            <i className="cas-autos__h">{hint(o.hint)}</i>
          </Button>
        ))}
      </div>
      {note && <p className="cas-sheet-note">{note}</p>}
    </div>
  );
}

/** Bet picker: the value, −/slider/+, an optional note and the confirm button. */
export function CasBetPicker({
  value,
  min,
  max,
  step,
  onChange,
  lessLabel,
  moreLabel,
  note,
  cta,
  ctaOff,
  onConfirm,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  lessLabel: string;
  moreLabel: string;
  note?: ReactNode;
  cta: string;
  ctaOff: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="cas-betpick px">
      <div className="cas-betpick__v cas-well px-num">
        {fmtNum(value)}
        <CoinIcon size={26} />
      </div>
      <div className="cas-betpick__row">
        <Button
          icon="minus"
          label={lessLabel}
          onClick={() => {
            selectionChanged();
            onChange(value - step);
          }}
        />
        <input
          className="cas-betpick__range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={lessLabel + ' / ' + moreLabel}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <Button
          icon="plus"
          label={moreLabel}
          onClick={() => {
            selectionChanged();
            onChange(value + step);
          }}
        />
      </div>
      {note && <p className="cas-sheet-note">{note}</p>}
      {/* Без монет кнопка серая, но жмётся (`off`): тап ничего не ставит — как раньше
          отключённая. */}
      <Button
        kind="primary"
        wide
        off={ctaOff}
        onClick={() => {
          if (ctaOff) return;
          onConfirm();
        }}
      >
        {cta}
      </Button>
    </div>
  );
}
