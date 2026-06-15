import { useEffect, useState } from 'react';

// Manual theme override. The app's look is driven by `:root[data-theme]` + the
// AppRoot appearance, both derived from `isDark`. "system" follows the platform
// (Telegram theme / OS); "light"/"dark" force it. The choice is stored locally.

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'coco-theme';
const listeners = new Set<() => void>();

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* private mode */
  }
  return 'system';
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* private mode */
  }
  listeners.forEach((fn) => fn());
}

/** Resolve the effective dark flag from the preference + the platform's dark. */
export function resolveDark(pref: ThemePref, systemDark: boolean): boolean {
  return pref === 'system' ? systemDark : pref === 'dark';
}

/** The stored theme preference, re-rendering when it changes (from settings). */
export function useThemePref(): ThemePref {
  const [pref, setPref] = useState(getThemePref);
  useEffect(() => {
    const fn = () => setPref(getThemePref());
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return pref;
}
