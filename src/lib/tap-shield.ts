// Tap shield (critic R44 / R72): a double tap must not do two things. For a short time after a
// guarded window opens (its veil / ✕ / content lie under the opener's thumb) or closes (the page
// under it — a paid Spin — lies under the closing card's thumb), a pointer gesture that STARTS in
// that time is swallowed whole, pointerdown … click, before React sees any of it. Window-level
// capture listeners: no overlay element, so nothing changes on screen and no z-index to keep.
// Keyboard / gamepad activations (`click` with `detail` 0) always pass.

/** A window ignores taps this long after it opens (Android `DOUBLE_TAP_TIMEOUT`). */
export const OPEN_GUARD_MS = 300;
/** The page ignores taps this long after a window closes (as `SKIP_GUARD_MS` after a skip). */
export const CLOSE_GUARD_MS = 350;

let until = 0;
/** The current gesture started inside the shield: its whole sequence is swallowed. */
let swallow = false;
/** When the last pointer gesture ended (pointerup / click): a double tap's clock. */
let lastUp = -Infinity;
let installed = false;
/** The last close raise: a mount in the same tick (StrictMode's re-mount, or a window that
 *  replaces the closed one) takes its own guard instead of inheriting the close one. */
let lastClose: { at: number; prev: number } | null = null;

const now = () => performance.now();

/** Pure decision for one event (exported for the unit test). */
export function shieldDecides(type: string, detail: number, t: number): 'block' | 'pass' {
  if (type === 'click' && detail === 0) return 'pass';
  if (type === 'pointerdown') swallow = t < until;
  if (type === 'pointerup' || type === 'click') lastUp = t;
  return swallow ? 'block' : 'pass';
}

const EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'touchstart',
  'touchend',
  'click',
  'dblclick',
] as const;

/** When the input HAPPENED, not when it was dispatched: a sheet's first render can hold the main
 *  thread 300 ms, and the second tap of a 90-ms double tap then arrives after a dispatch-time
 *  guard has run out (measured on tp, 2 of 6 runs). An event stamp from another clock (old
 *  WebKit's epoch ms) or from long ago falls back to now. */
function stamp(e: Event): number {
  const n = now();
  const t = e.timeStamp;
  return t > 0 && t <= n + 50 && n - t < 5000 ? t : n;
}

function onEvent(e: Event) {
  const detail = e instanceof UIEvent ? e.detail : 0;
  if (shieldDecides(e.type, detail, stamp(e)) === 'pass') return;
  e.stopImmediatePropagation();
  // Touch events stay passive (scrolling is untouched); the click they would make is blocked.
  if (e.cancelable && !e.type.startsWith('touch')) e.preventDefault();
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  for (const ev of EVENTS) window.addEventListener(ev, onEvent, { capture: true });
}

/** Swallows pointer gestures that start before `from + ms` (extends, never shortens). */
export function raiseTapShield(ms: number, from = now()): void {
  install();
  until = Math.max(until, from + ms);
}

/** A guarded window opened: taps are ignored until `OPEN_GUARD_MS` after the tap that opened it
 *  (Android counts a double tap from the first tap's up, so a slow mount doesn't stretch the
 *  guard), or after the mount when no tap was that recent (a window that opened by itself). */
export function shieldOnOpen(): void {
  const t = now();
  if (lastClose && t - lastClose.at < 1) until = lastClose.prev;
  lastClose = null;
  raiseTapShield(OPEN_GUARD_MS, t - lastUp < OPEN_GUARD_MS ? lastUp : t);
}

/** A guarded window closed: the page ignores taps for `CLOSE_GUARD_MS`. */
export function shieldOnClose(): void {
  lastClose = { at: now(), prev: until };
  raiseTapShield(CLOSE_GUARD_MS);
}

/** Test hook: drop any shield. */
export function resetTapShield(): void {
  until = 0;
  swallow = false;
  lastUp = -Infinity;
  lastClose = null;
}

// Listening from the start: the tap that opens the first window must already be timed.
install();
