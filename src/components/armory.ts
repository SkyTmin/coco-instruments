// Shared bits of the inventory-style screens (forge, backpack, books) on the pixel kit: the
// layout by the shell's format and the measured hero stage. Styles — `armory.css`.

import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { useFormFactor } from '@/game-shell';

/** `one` phone portrait, `two` tablet portrait, `three` landscape / tablet landscape / desktop. */
export type ArmLayout = 'one' | 'two' | 'three';

export function useArmLayout(): { layout: ArmLayout; u: number } {
  const { ff, landscape, scale } = useFormFactor();
  const layout: ArmLayout =
    ff === 'phone-portrait' ? 'one' : ff === 'tablet' && !landscape ? 'two' : 'three';
  return { layout, u: scale || 2 };
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
