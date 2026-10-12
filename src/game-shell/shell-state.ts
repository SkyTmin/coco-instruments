// Состояние каркаса: формат, размер окна, масштаб — одно на приложение,
// пересчитывается на resize, поворот и события вьюпорта Telegram.

import { useSyncExternalStore } from 'react';
import { useSettings } from '@/settings/store';
import { classifyFormFactor, uiScaleFor, type FormFactor, type UiScalePref } from './form-factor';

export interface ShellState {
  ff: FormFactor;
  /** Размер окна, CSS px. */
  w: number;
  h: number;
  /** Целый масштаб пиксель-арта (`--ui-scale`). */
  scale: number;
  dpr: number;
  landscape: boolean;
  /** Игровой маршрут сейчас открыт (атрибуты стоят на <html>). */
  game: boolean;
}

// Выбор игрока «размер интерфейса» живёт в общих настройках агента L
// (`useSettings().uiScale`, localStorage `coco.settings.v1`): каркас только
// читает его и пересчитывает масштаб при смене.
let pref: UiScalePref = useSettings.getState().uiScale;
useSettings.subscribe((st) => {
  if (st.uiScale === pref) return;
  pref = st.uiScale;
  refreshShell();
});
let game = false;
let state: ShellState = compute();
const subs = new Set<() => void>();

function viewportSize(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 390, h: 844 };
  return {
    w: Math.round(window.innerWidth || document.documentElement.clientWidth || 390),
    h: Math.round(window.innerHeight || document.documentElement.clientHeight || 844),
  };
}

function compute(): ShellState {
  const { w, h } = viewportSize();
  const ff = classifyFormFactor(w, h);
  return {
    ff,
    w,
    h,
    scale: uiScaleFor(w, h, pref),
    dpr: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
    landscape: w > h,
    game,
  };
}

/** Пересчитать и разослать, если что-то поменялось. */
export function refreshShell(): void {
  const next = compute();
  const s = state;
  if (
    next.ff === s.ff &&
    next.w === s.w &&
    next.h === s.h &&
    next.scale === s.scale &&
    next.dpr === s.dpr &&
    next.game === s.game
  )
    return;
  state = next;
  for (const fn of subs) fn();
}

export function setShellGame(on: boolean): void {
  game = on;
  refreshShell();
}

export function getShellState(): ShellState {
  return state;
}

export function subscribeShell(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Выбор игрока «размер интерфейса» (общие настройки, `auto` — сам). */
export function getUiScalePref(): UiScalePref {
  return pref;
}

export function setUiScalePref(p: UiScalePref): void {
  useSettings.getState().set({ uiScale: p });
}

/** Формат, размер и масштаб; перерисовка при смене. */
export function useFormFactor(): ShellState {
  return useSyncExternalStore(subscribeShell, getShellState, getShellState);
}
