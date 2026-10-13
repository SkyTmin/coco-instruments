// Shared bits of the inventory-style screens (forge, backpack, books) on the pixel kit: the
// layout by the shell's format and the measured hero stage. Styles — `armory.css`.

import { useEffect, useLayoutEffect, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { useFormFactor } from '@/game-shell';

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
