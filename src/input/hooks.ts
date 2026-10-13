// React-обёртки над шиной действий.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import type { Action, Bindings } from './actions';
import { getBindings, subscribeBindings } from './bindings';
import {
  onAction,
  onMoveAxis,
  pushGameplayCapture,
  type ActionEvent,
  type ActionPhase,
  type Axis,
} from './bus';
import {
  getInputDevice,
  getPadStyle,
  subscribeInputDevice,
  type InputDevice,
  type PadStyle,
} from './device';
import { inTopLayer } from './focus-nav';

export interface UseActionOptions {
  /** По умолчанию true. */
  enabled?: boolean;
  /** По умолчанию только 'down'. */
  phases?: ActionPhase[];
  /** Слушать, только когда этот элемент — на верхнем слое (под окном —
   *  молчать). Без scope — всегда. */
  scope?: RefObject<HTMLElement | null>;
  /** Не съедать событие (по умолчанию съедает: true → preventDefault). */
  passive?: boolean;
}

/**
 * Слушать действие(я). Обработчик может вернуть false — «не моё», тогда
 * событие идёт дальше по стеку (например, Tab без вкладок — фокус браузера).
 */
export function useAction(
  actions: Action | readonly Action[],
  handler: (e: ActionEvent) => boolean | void,
  opts: UseActionOptions = {},
): void {
  const ref = useRef(handler);
  ref.current = handler;
  const { enabled = true, phases, scope, passive } = opts;
  const list = typeof actions === 'string' ? actions : actions.join(',');
  const ph = (phases ?? ['down']).join(',');
  useEffect(() => {
    if (!enabled) return undefined;
    const set = new Set(list.split(','));
    const phs = new Set(ph.split(','));
    return onAction((e) => {
      if (!set.has(e.action) || !phs.has(e.phase)) return false;
      if (scope && !inTopLayer(scope.current)) return false;
      const r = ref.current(e);
      if (r === false) return false;
      return !passive;
    });
  }, [list, ph, enabled, scope, passive]);
}

/** Горячие клавиши: `{ inventory: () => …, pets: () => … }`. */
export function useHotkeys(
  map: Partial<Record<Action, () => void>>,
  opts: Omit<UseActionOptions, 'phases'> = {},
): void {
  const ref = useRef(map);
  ref.current = map;
  const keys = Object.keys(map).sort() as Action[];
  useAction(
    keys,
    (e) => {
      const fn = ref.current[e.action];
      if (!fn) return false;
      fn();
      return true;
    },
    opts,
  );
}

/** Ось движения (клавиши + стик). Зовётся только при изменении. */
export function useMoveAxis(fn: (a: Axis) => void, enabled = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => (enabled ? onMoveAxis((a) => ref.current(a)) : undefined), [enabled]);
}

/** Пока `active` — стрелки и крестовина двигают героя, а не фокус. */
export function useGameplayCapture(active: boolean): void {
  useEffect(() => (active ? pushGameplayCapture() : undefined), [active]);
}

export function useInputDevice(): InputDevice {
  return useSyncExternalStore(subscribeInputDevice, getInputDevice, () => 'touch');
}

export function usePadStyle(): PadStyle {
  return useSyncExternalStore(subscribeInputDevice, getPadStyle, () => 'xbox');
}

export function useBindings(): Bindings {
  return useSyncExternalStore(subscribeBindings, getBindings, getBindings);
}

function padConnected(): boolean {
  try {
    const list = typeof navigator !== 'undefined' ? navigator.getGamepads?.() : null;
    return !!list && Array.from(list).some((p) => !!p && p.connected);
  } catch {
    return false;
  }
}

function subscribePads(fn: () => void): () => void {
  window.addEventListener('gamepadconnected', fn);
  window.addEventListener('gamepaddisconnected', fn);
  return () => {
    window.removeEventListener('gamepadconnected', fn);
    window.removeEventListener('gamepaddisconnected', fn);
  };
}

/** Геймпад подключён. Браузер видит его только после первого нажатия. */
export function usePadConnected(): boolean {
  return useSyncExternalStore(subscribePads, padConnected, () => false);
}
