// Casino frame (UI wave 2 — K): the pieces Slots and Cascade share around their skin cabinet —
// the fit-to-box scaler, the control deck (balance, bet −/+, Spin, auto, turbo) and the info
// cells. The cabinet itself (reels, grid, lever, skins) is untouched: it is drawn at its old
// fixed pixel size and scaled as one piece, because the reel motion moves in those pixels.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, ReactNode, RefObject } from 'react';
import { Button, Icon, KeyHint, usePress } from '@/ui-px';
import type { PxIconName } from '@/ui-px';
import { useAction } from '@/input/hooks';
import { useFormFactor } from '@/game-shell';
import { inTopLayer } from '@/input/focus-nav';
import { CoinIcon } from '@/components/slot-art';
import { BETS } from '@/lib/slots';
import { spinReel } from '@/lib/reel-motion';
import type { ReelPlan } from '@/lib/reel-motion';
import { selectionChanged, tapLight } from '@/lib/haptics';
import { uiTap } from '@/lib/sound';
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
 * One reel strip's spin (`spinReel`) that can be LANDED at once: when `slam` grows (the Skip
 * press), the running animation and its blur / impact timers are cancelled — the strip already
 * stands at its end (`spinReel` sets the final transform inline) — and `onStop` fires now if
 * the reel had not landed yet. The outcome is fixed before the reels start; only the show ends.
 */
export function useReelSpin<T>(
  ref: RefObject<HTMLElement>,
  plan: ReelPlan<T>,
  spinId: number,
  onStop: () => void,
  slam: number,
): void {
  const stopRef = useRef(onStop);
  stopRef.current = onStop;
  const live = useRef<{ landed: boolean; cancel?: () => void }>({ landed: true });
  // Before paint, not after: else the first frame of a spin showed the strip at rest.
  useLayoutEffect(() => {
    const st: { landed: boolean; cancel?: () => void } = { landed: false };
    live.current = st;
    st.cancel = spinReel(ref.current, plan, spinId, () => {
      st.landed = true;
      stopRef.current();
    });
    return () => st.cancel?.();
  }, [ref, spinId, plan]);
  useLayoutEffect(() => {
    if (!slam) return;
    const st = live.current;
    st.cancel?.();
    st.cancel = undefined;
    if (st.landed) return;
    st.landed = true;
    stopRef.current();
  }, [slam]);
}

/** Tempo of the rest of a spin after the Skip press (× the turbo factor): links and the count. */
export const SKIP_TEMPO = 0.45;
/**
 * После «Пропустить» кнопка снова «Крутить», и быстрый второй тап запускал новый спин (ставка!).
 * Тап «Крутить» раньше этого срока после пропуска — мимо (Android DOUBLE_TAP_TIMEOUT = 300 мс).
 */
export const SKIP_GUARD_MS = 350;
/**
 * Зеркало: «Пропустить» раньше этого срока после старта спина не считается — двойной тап
 * (90 мс) запускал спин и тут же съедал весь показ.
 */
export const SKIP_START_MS = 250;

/** Строка правил «A · B»: точка держится за левую половину, перенос — после неё. */
export const keepDot = (s: string) => s.replace(/ · /g, '\u00a0· ');

/**
 * Page layout: «tall» = info strip, stage, deck in one column (phone portrait and tablet
 * portrait — there the width is the limit, so the stage gets all the height left); «wide» =
 * info | stage | deck columns (phone landscape, tablet landscape, desktop).
 */
export function useCasLayout(): 'tall' | 'wide' {
  const { ff, landscape } = useFormFactor();
  return ff === 'phone-portrait' || (ff === 'tablet' && !landscape) ? 'tall' : 'wide';
}

/** Phone landscape: the page renders no GameTop row (critic 7c: it took 62 of 390 px). */
export function useCasLying(): boolean {
  return useFormFactor().ff === 'phone-landscape';
}

/** Круглая кнопка шапки (`gx-round`): нажатие видно в первый кадр (`usePress` → `.is-down`). */
export function CasRound({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const ref = useRef<HTMLButtonElement>(null);
  const press = usePress(ref);
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      {...press}
      className={`gx-round gx-round--dark${className ? ` ${className}` : ''}`}
    />
  );
}

/**
 * Phone landscape: back + the page's own top buttons (skins, rules, settings) as one row of
 * 44-px icons at the top of the info column, instead of the GameTop row over the whole page.
 */
export function CasTools({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const t = useT();
  return (
    <div className="cas-tools">
      <Button
        icon="left"
        label={t('common.back')}
        className="cas-tools__back"
        onClick={() => {
          tapLight();
          uiTap();
          onBack();
        }}
      />
      {children}
    </div>
  );
}

/**
 * Steps the font of a box down (`data-fit` 1, 2) until its text fits the width — a long number
 * gets smaller instead of losing its tail. Measured before paint, on resize and on a text change.
 */
function useFitText<T extends HTMLElement = HTMLElement>(dep: unknown, on: boolean) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const fit = () => {
      el.dataset.fit = '0';
      for (let i = 1; i <= 2 && el.scrollWidth > el.clientWidth + 1; i++)
        el.dataset.fit = String(i);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    // A rolling number (AnimatedNumber) changes its text without a new `dep` — «18 тыс.» →
    // «988 тыс.» kept the step measured for the short text and lost its tail.
    const mo = new MutationObserver(fit);
    mo.observe(el, { characterData: true, childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [dep, on]);
  return ref;
}

export function CasStat({
  icon,
  value,
  label,
  tone,
  className,
  fit = false,
  tip,
}: {
  icon: ReactNode;
  value: ReactNode;
  label: ReactNode;
  tone?: 'gold';
  className?: string;
  /** The exact value when `value` is compact (hover / long press). */
  tip?: string;
  /** Shrink a long value to fit (the hall: static numbers; not in play, where it would jump). */
  fit?: boolean;
}) {
  const vRef = useFitText(value, fit);
  return (
    <div
      className={`cas-stat${tone ? ` cas-stat--${tone}` : ''}${className ? ` ${className}` : ''}`}
      data-tip={tip}
    >
      <span className="cas-stat__ico">{icon}</span>
      <b ref={vRef} className="cas-stat__v px-num">
        {value}
      </b>
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
  /** The verb only («Крутить», «Нет монет»): the stake already sits in the bet well above. */
  spinLabel: string;
  /** A count on the spin plate's corner: free spins, bonus spins left, auto spins left. */
  spinBadge?: ReactNode;
  /**
   * While a spin plays, the plate stays gold and SKIPS the show (the outcome is already fixed):
   * the page's handler stops the reels, then hurries the links and the count. Space / pad A
   * call the same handler.
   */
  onSkip?: () => void;
  spinDisabled: boolean;
  /** A tap on the plate while it is off: the page says why (status line, haptic). */
  onBlocked?: () => void;
  /** Bumped by the page when a spin was refused: the plate shakes by one art pixel. */
  nope?: number;
  busy: boolean;
  onSpin: () => void;
  auto: number;
  autoDisabled: boolean;
  onAuto: () => void;
  turbo: boolean;
  onTurbo: () => void;
  /** Cascade (wide layouts): the buy-bonus row above the money. */
  extra?: ReactNode;
  /** Cascade: the Ante toggle at the right end of the bet row. */
  betSide?: ReactNode;
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
  // Auto keeps its «Stop» plate; otherwise a running spin turns the plate into «Skip».
  const skipping = p.spinning && !!p.onSkip && !autoOn;
  const skipText = t('slots.btn.skip');
  const spinText = skipping ? skipText : p.spinLabel;
  // Every label the plate can show (spin, free, bonus, broke, stop, skip with its icon) sits in
  // one grid cell, only the current one visible: the font step is found once for the longest of
  // them, so «Крутить» → «Пропустить» no longer shrinks and grows the text on every spin. A long
  // verb steps the font down (then wraps at the smallest step), never an ellipsis.
  const labels = [
    ...new Set([
      p.spinLabel,
      t('slots.btn.spinShort'),
      t('slots.btn.freeShort'),
      t('slots.btn.bonusShort'),
      t('slots.btn.brokeShort'),
      t('slots.btn.stopShort'),
      skipText,
    ]),
  ];
  const spinRef = useFitText<HTMLSpanElement>(labels.join('|'), true);
  const betPress = usePress<HTMLButtonElement>();
  // «Нет монет»: the plate shakes one art pixel (class restarted on each refusal).
  useEffect(() => {
    if (!p.nope) return undefined;
    const el = root.current?.querySelector<HTMLElement>('.cas-spin');
    if (!el) return undefined;
    el.classList.remove('is-nope');
    void el.offsetWidth;
    el.classList.add('is-nope');
    const tm = setTimeout(() => el.classList.remove('is-nope'), 400);
    return () => clearTimeout(tm);
  }, [p.nope]);
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
              {...betPress}
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
            {p.betSide}
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
          className={`cas-spin${p.busy ? ' is-busy' : ''}${skipping ? ' is-skip' : ''}`}
          off={skipping ? false : p.spinDisabled}
          hint="confirm"
          data-autofocus=""
          aria-label={spinText}
          onClick={() => {
            if (skipping) {
              p.onSkip?.();
              return;
            }
            if (p.spinDisabled) {
              p.onBlocked?.();
              return;
            }
            p.onSpin();
          }}
        >
          <span className="cas-spin__t" ref={spinRef}>
            {labels.map((l) => (
              <span
                key={l}
                className={`cas-spin__l${l === spinText ? ' is-on' : ''}`}
                aria-hidden={l === spinText ? undefined : true}
              >
                {l === skipText && <Icon name="skip" />}
                {l}
              </span>
            ))}
          </span>
          {!skipping && p.spinBadge != null && (
            <b className="cas-mini__n cas-spin__n px-num">{p.spinBadge}</b>
          )}
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
