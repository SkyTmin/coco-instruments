// Плавающий джойстик — общий для подземелья и площади (v2.80). В покое он
// стоит внизу слева полупрозрачным: видно, чем ходить. Коснулся — основа
// встаёт под палец, ушёл пальцем дальше края — основа едет за ним (как в
// Brawl Stars), отпустил — возвращается на место. Мёртвая зона 14%: дрожь
// пальца не двигает героя.
//
// Двигается мимо React: основа и ручка пишутся в `style.transform` прямо в
// обработчике указателя. Ход пальца — десятки событий в секунду, и
// перерисовывать ради них страницу незачем.

import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

/** Радиус хода ручки, CSS px. */
export const STICK_R = 46;
/** Палец сдвинулся меньше — это тап, а не джойстик (ленивый режим). */
const TAP_SLOP = 10;
/** Дольше — это уже не тап, даже без сдвига. */
const TAP_MS = 350;

interface Touch {
  id: number;
  /** Центр основы в координатах корня. */
  x: number;
  y: number;
  /** Где палец коснулся. */
  sx: number;
  sy: number;
  t: number;
  /** Джойстик уже показан (в ленивом режиме — после первого сдвига). */
  live: boolean;
}

export interface StickOpts {
  rootRef: RefObject<HTMLElement>;
  /** Свои ссылки на основу и ручку — если страница меряет джойстик сама. */
  stickRef?: RefObject<HTMLDivElement>;
  knobRef?: RefObject<HTMLElement>;
  /** Какая доля ширины слева ставит джойстик (подземелье — 0,55: справа кнопки). */
  zone?: number;
  /**
   * Ленивый джойстик: основа появляется, только когда палец сдвинулся.
   * Тап без сдвига возвращается из `up` — на площади это «иди сюда».
   */
  lazy?: boolean;
  onMove: (mx: number, my: number) => void;
}

export interface StickApi {
  stickRef: RefObject<HTMLDivElement>;
  knobRef: RefObject<HTMLElement>;
  /** Палец коснулся корня. true — палец взят джойстиком. */
  down: (e: ReactPointerEvent) => boolean;
  move: (e: ReactPointerEvent) => void;
  /** Палец поднят. Тап (ленивый режим, без сдвига) — его точка в координатах корня. */
  up: (e: ReactPointerEvent) => { x: number; y: number } | null;
  /** Бросить палец (открылось окно) и вернуть джойстик на место. */
  release: () => void;
  park: () => void;
}

export function useFloatingStick({
  rootRef,
  zone = 0.55,
  lazy = false,
  onMove,
  ...refs
}: StickOpts): StickApi {
  const ownStick = useRef<HTMLDivElement>(null);
  const ownKnob = useRef<HTMLElement>(null);
  const stickRef = refs.stickRef ?? ownStick;
  const knobRef = refs.knobRef ?? ownKnob;
  const touch = useRef<Touch | null>(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  // Джойстик в покое стоит внизу слева полупрозрачным: видно, чем ходить.
  const park = useCallback(() => {
    const s = stickRef.current;
    const el = rootRef.current;
    if (!s || !el) return;
    const h = el.clientHeight;
    s.style.transform = `translate(${36}px, ${Math.max(120, h - 210)}px)`;
    s.classList.remove('is-on');
    s.classList.add('is-idle');
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
  }, [rootRef, stickRef, knobRef]);
  useEffect(() => {
    park();
    window.addEventListener('resize', park);
    return () => window.removeEventListener('resize', park);
  }, [park]);

  const show = (x: number, y: number) => {
    const s = stickRef.current;
    if (s) {
      s.style.transform = `translate(${x - 60}px, ${y - 60}px)`;
      s.classList.remove('is-idle');
      s.classList.add('is-on');
    }
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
  };

  const down = (e: ReactPointerEvent): boolean => {
    const el = rootRef.current;
    if (!el || touch.current) return false;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x >= rect.width * zone) return false;
    touch.current = { id: e.pointerId, x, y, sx: x, sy: y, t: performance.now(), live: !lazy };
    if (!lazy) show(x, y);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* нет захвата — и ладно */
    }
    return true;
  };

  const move = (e: ReactPointerEvent) => {
    const s = touch.current;
    if (!s || s.id !== e.pointerId) return;
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!s.live) {
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (Math.hypot(px - s.sx, py - s.sy) < TAP_SLOP) return;
      // Сдвинулся — это джойстик: основа там, где палец коснулся.
      s.live = true;
      show(s.x, s.y);
    }
    let dx = e.clientX - rect.left - s.x;
    let dy = e.clientY - rect.top - s.y;
    const len = Math.hypot(dx, dy);
    // Палец ушёл дальше края — основа едет за ним (как в Brawl Stars).
    if (len > STICK_R * 1.6) {
      const k = (len - STICK_R * 1.6) / len;
      s.x += dx * k;
      s.y += dy * k;
      dx -= dx * k;
      dy -= dy * k;
      if (stickRef.current)
        stickRef.current.style.transform = `translate(${s.x - 60}px, ${s.y - 60}px)`;
    }
    const l2 = Math.hypot(dx, dy);
    const k = l2 > STICK_R ? STICK_R / l2 : 1;
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const mag = Math.min(1, l2 / STICK_R);
    // Мёртвая зона: дрожь пальца не двигает героя.
    const m = mag < 0.14 ? 0 : (mag - 0.14) / 0.86;
    moveRef.current(l2 > 0 ? (dx / l2) * m : 0, l2 > 0 ? (dy / l2) * m : 0);
  };

  const up = (e: ReactPointerEvent): { x: number; y: number } | null => {
    const s = touch.current;
    if (!s || s.id !== e.pointerId) return null;
    touch.current = null;
    moveRef.current(0, 0);
    park();
    if (!s.live && performance.now() - s.t < TAP_MS) return { x: s.sx, y: s.sy };
    return null;
  };

  const release = useCallback(() => {
    touch.current = null;
    moveRef.current(0, 0);
    park();
  }, [park]);

  return { stickRef, knobRef, down, move, up, release, park };
}

/** Разметка джойстика: основа и ручка (CSS — `.dg-stick` в game-ui.css). */
export function FloatingStick({ api }: { api: Pick<StickApi, 'stickRef' | 'knobRef'> }) {
  return (
    <div className="dg-stick is-idle" ref={api.stickRef} aria-hidden="true">
      <i ref={api.knobRef} />
    </div>
  );
}
