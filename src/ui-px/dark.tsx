// Dark pixel kit — React side. The palette lives in ONE token block (`.pxd` in `dark.css`); the
// frames are drawn from those tokens once per page (`installPxdFrames` → a <style> with
// `--pxd-f-*` pictures), so a palette edit recolours every frame. Pictures: `dark-art.ts`.
//
// Pieces: frame classes `.pxd-f .pxd-f--panel|sel|well|oct|act|off`, `PxdButton` (press in the
// first frame, `aria-disabled` stays tappable), `PxdRibbon` (name banner), `PxdPips`,
// `PxdSocket`, `PxdGem`, `PxdPedestal`, `PxdSheet` (portal, escape stack, own input layer).

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, PropsWithChildren, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Prompt } from '@/input';
import type { Action } from '@/input';
import { registerEscape } from '@/lib/escape-stack';
import { tapLight } from '@/lib/haptics';
import { uiClose, uiOpen } from '@/lib/sound';
import { chamfer, gem, mix, pedestal, ribbon, socket } from './dark-art';
import { usePress } from './index';
import './dark.css';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const KEYS = [
  'bg',
  'panel',
  'hi',
  'lo',
  'well',
  'ink',
  'press',
  'text',
  'muted',
  'accent',
  'ok',
  'act',
  'act-hi',
  'act-lo',
  'act-lip',
  'off',
  'off-hi',
  'off-lo',
  'off-lip',
  'rib',
  'rib-hi',
  'rib-lo',
  'rib2',
  'rib-fold',
] as const;
export type PxdTokens = Record<(typeof KEYS)[number], string>;

let tokens: PxdTokens | null = null;

/** The palette's colours, read once from the `.pxd` token block (a hidden probe element). */
export function pxdTokens(): PxdTokens {
  if (tokens) return tokens;
  const probe = document.createElement('div');
  probe.className = 'pxd';
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const v = Object.fromEntries(
    KEYS.map((k) => [k, cs.getPropertyValue(`--pd-${k}`).trim().toLowerCase() || '#ff00ff']),
  ) as PxdTokens;
  probe.remove();
  tokens = v;
  return v;
}

let installed = false;

/** Draws the frame pictures for the palette into `<style id="pxd-frames">` (once per page). */
export function installPxdFrames(): void {
  if (installed || typeof document === 'undefined') return;
  const v = pxdTokens();
  const up = mix(v.panel, v.hi, 0.35);
  const act = { ink: v.ink, hi: v['act-hi'], lo: v['act-lo'], fill: v.act, lip: v['act-lip'] };
  const vars: Record<string, string> = {
    panel: chamfer(2, { ink: v.ink, hi: v.hi, lo: v.lo, fill: v.panel }),
    'panel-hover': chamfer(2, { ink: v.ink, hi: mix(v.hi, '#ffffff', 0.12), lo: v.lo, fill: up }),
    'panel-down': chamfer(2, { ink: v.ink, hi: v.lo, lo: v.hi, fill: v.press }),
    sel: chamfer(2, { ink: v.accent, hi: v['act-lo'], lo: v.lo, fill: v.panel }),
    'sel-down': chamfer(2, { ink: v.accent, hi: v.lo, lo: v['act-lo'], fill: v.press }),
    well: chamfer(1, { ink: v.ink, hi: v.lo, lo: v.hi, fill: v.well }),
    oct: chamfer(6, { ink: v.ink, hi: v.lo, lo: v.hi, fill: v.well }),
    act: chamfer(3, act, 2),
    'act-hover': chamfer(3, { ...act, fill: mix(v.act, v['act-hi'], 0.35) }, 2),
    'act-down': chamfer(3, act, 2, true),
    off: chamfer(
      3,
      { ink: v.ink, hi: v['off-hi'], lo: v['off-lo'], fill: v.off, lip: v['off-lip'] },
      2,
    ),
    ribbon: ribbon({
      ink: v.ink,
      face: v.rib,
      hi: v['rib-hi'],
      lo: v['rib-lo'],
      tail: v.rib2,
      fold: v['rib-fold'],
    }),
  };
  const css = `.pxd{${Object.entries(vars)
    .map(([k, u]) => `--pxd-f-${k}:${u};`)
    .join('')}}`;
  let el = document.getElementById('pxd-frames') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'pxd-frames';
    document.head.appendChild(el);
  }
  el.textContent = css;
  installed = true;
}

/** Call at the top of a screen on the dark kit: frames are in place before its first paint. */
export function usePxd(): void {
  useLayoutEffect(() => installPxdFrames(), []);
}

// ---- Pictures ----------------------------------------------------------------------------------

const pics = new Map<string, string>();
const pic = (key: string, make: () => string) => {
  let u = pics.get(key);
  if (!u) {
    u = make();
    pics.set(key, u);
  }
  return u;
};

function Img({
  url,
  w,
  h,
  className,
  label,
  style,
}: {
  url: string;
  w: number;
  h: number;
  className?: string;
  label?: string;
  style?: CSSProperties;
}) {
  return (
    <i
      className={cx('pxd-img', className)}
      style={{ ...style, '--pxd-img': url, '--w': w, '--h': h } as CSSProperties}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** A round enchant socket (`d` art px, 20 by default): empty = «+», filled = a gem of `gem` colour. */
export function PxdSocket({
  gem: g,
  d = 20,
  className,
}: {
  gem?: string;
  d?: number;
  className?: string;
}) {
  const v = pxdTokens();
  const url = pic(`sock:${d}:${g ?? ''}`, () =>
    socket({ ink: v.ink, hi: v.hi, lo: v.lo, well: v.well, mark: v.muted, gem: g }, d),
  );
  return <Img url={url} w={d} h={d} className={cx('pxd-socket', className)} />;
}

/** An 8×8 cut gem of an ore / enchant colour. */
export function PxdGem({ color, className }: { color: string; className?: string }) {
  const v = pxdTokens();
  const url = pic(`gem:${color}`, () => gem(color, v.ink));
  return <Img url={url} w={8} h={8} className={cx('pxd-gem', className)} />;
}

/** An elliptic plinth `w` art px wide. */
export function PxdPedestal({
  w,
  className,
  style,
}: {
  w: number;
  className?: string;
  style?: CSSProperties;
}) {
  const v = pxdTokens();
  const ww = Math.max(15, Math.round(w) | 1);
  const h = Math.max(7, Math.round(ww / 6) | 1);
  const url = pic(`ped:${ww}`, () =>
    pedestal(ww, { ink: v.ink, hi: v.hi, mid: v.panel, lo: v.lo }, h),
  );
  return <Img url={url} w={ww} h={h} className={cx('pxd-ped', className)} style={style} />;
}

/** `n` squares, the first `on` lit: progress without a long bar. */
export function PxdPips({
  n,
  on,
  ok,
  label,
  className,
}: {
  n: number;
  on: number;
  ok?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cx('pxd-pips', ok && 'is-ok', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < on ? 'is-on' : undefined} />
      ))}
    </span>
  );
}

/** The name banner with swallowtail ends; the text colour is `--rc` (rarity) if set. */
export function PxdRibbon({
  children,
  className,
  style,
}: PropsWithChildren<{ className?: string; style?: CSSProperties }>) {
  return (
    <div className={cx('pxd-ribbon', className)} style={style}>
      <h2>{children}</h2>
    </div>
  );
}

// ---- Button ------------------------------------------------------------------------------------

export type PxdFrame = 'panel' | 'sel' | 'well' | 'act';

export type PxdButtonProps = {
  frame?: PxdFrame;
  /** Greyed but still tappable — the tap explains why (`aria-disabled`). */
  off?: boolean;
  hint?: Action;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function PxdButton({
  frame = 'panel',
  off,
  hint,
  className,
  children,
  onPointerDown,
  onPointerLeave,
  ...rest
}: PxdButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const press = usePress(ref);
  const f = frame === 'act' && off ? 'off' : frame;
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      aria-disabled={off || undefined}
      onPointerDown={(e) => {
        press.onPointerDown(e);
        onPointerDown?.(e);
      }}
      onPointerLeave={(e) => {
        press.onPointerLeave(e);
        onPointerLeave?.(e);
      }}
      className={cx('pxd-btn pxd-f px-f', `pxd-f--${f}`, className)}
    >
      {children}
      {hint && <Prompt action={hint} className="px-keyhint" />}
    </button>
  );
}

// ---- Sheet -------------------------------------------------------------------------------------

/**
 * A dark window over the screen: docked at the bottom on phones, centred elsewhere. Closes on ✕,
 * a tap outside and Escape / B (escape stack); its own `data-ui-layer`, so keys and the pad stay
 * inside; focus goes to `[data-autofocus]` (or the first button) and back to the opener.
 */
export function PxdSheet({
  title,
  sub,
  closeLabel,
  onClose,
  width,
  className,
  children,
}: PropsWithChildren<{
  title: ReactNode;
  sub?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /** Max width in art pixels. */
  width?: number;
  className?: string;
}>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const box = useRef<HTMLDivElement>(null);
  usePxd();
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    uiOpen();
    const off = registerEscape(() => closeRef.current());
    const el = box.current;
    const first =
      el?.querySelector<HTMLElement>('[data-autofocus]') ??
      el?.querySelector<HTMLElement>('button');
    first?.focus({ preventScroll: true });
    return () => {
      off();
      uiClose();
      back?.focus?.({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div className="px pxd pxd-veil" data-ui-layer="" onClick={onClose}>
      <div
        ref={box}
        className={cx('pxd-sheet pxd-f pxd-f--panel', className)}
        style={width ? ({ '--mw': width } as CSSProperties) : undefined}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pxd-sheet__head">
          <h2 className="pxd-sheet__title">
            {title}
            {sub != null && <small>{sub}</small>}
          </h2>
          <PxdButton
            className="pxd-sheet__close"
            aria-label={closeLabel}
            onClick={() => {
              tapLight();
              onClose();
            }}
          >
            <i className="px-i pxi-x" aria-hidden="true" />
          </PxdButton>
        </div>
        <div className="pxd-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
