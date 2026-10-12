// Состояние каркаса: формат, размер окна, масштаб — одно на приложение,
// пересчитывается на resize, поворот и события вьюпорта Telegram.

import { useSyncExternalStore } from 'react';
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

const PREF_KEY = 'ui.scale.v1';

function readPref(): UiScalePref {
  try {
    const v = localStorage.getItem(PREF_KEY);
    const n = Number(v);
    return v && Number.isInteger(n) && n >= 1 && n <= 6 ? (n as UiScalePref) : 'auto';
  } catch {
    return 'auto';
  }
}

let pref: UiScalePref = typeof window === 'undefined' ? 'auto' : readPref();
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

/** Выбор игрока «размер интерфейса» (для экрана настроек). */
export function getUiScalePref(): UiScalePref {
  return pref;
}

export function setUiScalePref(p: UiScalePref): void {
  pref = p;
  try {
    if (p === 'auto') localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, String(p));
  } catch {
    /* без сохранения */
  }
  refreshShell();
}

/** Формат, размер и масштаб; перерисовка при смене. */
export function useFormFactor(): ShellState {
  return useSyncExternalStore(subscribeShell, getShellState, getShellState);
}
