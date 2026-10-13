// Shared bits of the inventory-style screens (forge, backpack, books) on the pixel kit: the
// layout by the shell's format and the measured hero stage. Styles — `armory.css`.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { useFormFactor } from '@/game-shell';
import { preloadPx } from '@/components/PxStrip';
import { BOOK_TIERS } from '@/lib/books';
import { PICKS } from '@/lib/economy';
import { ROCKS } from '@/lib/prison';

/** `one` phone portrait, `two` tablet portrait, `three` landscape / tablet landscape / desktop. */
export type ArmLayout = 'one' | 'two' | 'three';

export function useArmLayout(): { layout: ArmLayout; u: number } {
  const { ff, landscape, scale } = useFormFactor();
  const layout: ArmLayout =
    ff === 'phone-portrait' ? 'one' : ff === 'tablet' && !landscape ? 'two' : 'three';
  return { layout, u: scale || 2 };
}

/**
 * false on the first render, true from the next frame. The window (frames, titles, showcase,
 * buttons) paints right after the tap, the slot grids follow a frame later: their render was most
 * of the 0.3–0.6 s between a tap and the first frame on a slow phone (critic, 4× CPU).
 */
export function useFirstFrame(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return ready;
}

/** Size of an element's content box, kept in state: the hero art is sized from it. */
export function useBox(ref: RefObject<HTMLElement | null>, on = true) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const put = (w: number, h: number) =>
      setBox((b) =>
        b.w === Math.floor(w) && b.h === Math.floor(h) ? b : { w: Math.floor(w), h: Math.floor(h) },
      );
    put(el.clientWidth, el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => put(e.contentRect.width, e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, on]);
  return box;
}

/** The biggest square that fits the box, in whole art pixels of the UI (`u`), capped. */
export function heroSize(box: { w: number; h: number }, u: number, max: number, min = 48): number {
  const s = Math.min(box.w, box.h, max);
  if (s <= 0) return 0;
  return Math.max(min, Math.floor(s / u) * u);
}

/**
 * `heroSize` for art standing on the pedestal: `.arm-ped` adds 3 pedestal pixels under the art,
 * so the square shrinks by whole `u` until art + pedestal fit the room's height.
 */
export function heroFit(
  box: { w: number; h: number },
  u: number,
  max: number,
  pedOf: (art: number) => number,
  min = 48,
): number {
  let s = heroSize(box, u, max, min);
  while (s > min && s + 3 * pedOf(s) > box.h) s -= u;
  return s;
}

/** `--nlen` for a stat value that can be long («35–75 %», «IV–VII»): characters, an icon counts 2.
 *  CSS shrinks such a value to its cell (armory.css, `.arm-stat > b[style]`). */
export function numFit(s: string, icon = false): CSSProperties {
  return { '--nlen': Math.max(4, s.length + (icon ? 2 : 0)) } as CSSProperties;
}

/**
 * The name plate's size hints: the whole name (`--nlen`, one line on a stacked plate) and its
 * longest word (`--wlen`, a two-line plate beside the art). `armory.css` shrinks the name to fit,
 * so words break between words, never inside («Goldspitzhacke», «Эффективность»).
 */
export function nameFit(name: ReactNode): CSSProperties {
  const s = typeof name === 'string' ? name : '';
  const w = Math.max(8, ...s.split(/\s+/).map((x) => x.length));
  return { '--wlen': w, '--nlen': Math.max(8, s.length) } as CSSProperties;
}

/**
 * Two-tap confirmations («В пыль», «Снять», «Перековать», the big chest): `mark()` when the first
 * tap arms the button, `tooSoon()` is true for 400 ms after it — a confirming tap that soon is the
 * second half of a double tap and is ignored (critic: two taps 90 ms apart dusted a book; Android's
 * double-tap window is 300 ms).
 */
export const ARM_GUARD_MS = 400;
export function useArmGuard(): { mark: () => void; tooSoon: () => boolean } {
  const at = useRef(-Infinity);
  return {
    mark: () => {
      at.current = performance.now();
    },
    tooSoon: () => performance.now() - at.current < ARM_GUARD_MS,
  };
}

/** A keyboard / gamepad click (Enter, Space, the bus) has `detail === 0`; a tap or a mouse click
 *  counts its clicks. A second tap on a selected cell must not act — touch acts only through the
 *  action button (critic: a long press to read the tip forged the pick on release). */
export const fromKeys = (e: { detail: number }) => e.detail === 0;

let fullWins = 0;
let fullScenes = 0;
/**
 * While a full-screen window (`.arm.is-window`) or a result scene is mounted: `html[data-fullwin]`
 * (and `data-fullscene` for a scene). The mine (`.pmx`) and a camp under a scene stop painting —
 * their canvas and animations ate the frames the window needed to open (critic: 313–557 ms on a
 * 4× slower CPU). A layout effect, so the first frame of the window is already alone.
 */
export function useFullWin(on = true, scene = false): void {
  useLayoutEffect(() => {
    if (!on) return undefined;
    const d = document.documentElement.dataset;
    fullWins++;
    d.fullwin = '';
    if (scene) {
      fullScenes++;
      d.fullscene = '';
    }
    return () => {
      if (!--fullWins) delete d.fullwin;
      if (scene && !--fullScenes) delete d.fullscene;
    };
  }, [on, scene]);
}

/** Kit frame PNGs (`--pxk-*: url(…)` on `:root`), read from the loaded style sheets. */
function kitUrls(): string[] {
  const out = new Set<string>();
  for (const sh of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sh.cssRules;
    } catch {
      continue; // another origin
    }
    for (const r of Array.from(rules)) {
      if (!(r instanceof CSSStyleRule) || r.selectorText !== ':root') continue;
      for (let i = 0; i < r.style.length; i++) {
        const k = r.style[i];
        if (!k.startsWith('--pxk-')) continue;
        const m = /url\(['"]?([^'")]+)/.exec(r.style.getPropertyValue(k));
        if (m) out.add(m[1]);
      }
    }
  }
  return [...out];
}

/**
 * Decode, when the mine is idle, what the forge, the backpack and the books show first: the kit
 * frames, the current pick's spin, the pick icons, the book idle strips and the ore icons. The
 * windows then open without decoding images in their first frame. Returns the cancel.
 */
export function predecodeArmory(pick: number): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const w = window as Window & {
    requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  let off = false;
  const decode = (src: string) => {
    const im = new Image();
    im.decoding = 'async';
    im.src = src;
    return im.decode().catch(() => undefined);
  };
  const run = async () => {
    const jobs: (() => Promise<unknown>)[] = [
      ...kitUrls().map((s) => () => decode(s)),
      () => preloadPx('picks', `spin-${pick}`),
      ...PICKS.map((_, i) => () => preloadPx('picks', `icon-${i}`)),
      ...BOOK_TIERS.map((b) => () => preloadPx('books', `idle-${b.id}`)),
      ...ROCKS.map((_, i) => () => decode(`/ui/ores/r${i}-0.png`)),
    ];
    // A few at a time: the mine keeps its frames.
    for (let i = 0; i < jobs.length && !off; i += 4)
      await Promise.all(jobs.slice(i, i + 4).map((j) => j()));
  };
  const id = w.requestIdleCallback
    ? w.requestIdleCallback(() => void run(), { timeout: 4000 })
    : window.setTimeout(() => void run(), 1500);
  return () => {
    off = true;
    if (w.cancelIdleCallback) w.cancelIdleCallback(id);
    else window.clearTimeout(id);
  };
}
