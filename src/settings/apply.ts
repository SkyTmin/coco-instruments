import { useFinanceStore } from '@/store';
import { setVolumes } from '@/lib/sound';
import { setHapticsMuted } from '@/lib/haptics';
import { useSettings } from './store';
import type { DeviceSettings } from './store';
import './settings.css';

/**
 * Settings → the world. Started once from `main.tsx`; everything else just
 * reads the DOM attributes / CSS variables below.
 *
 * On `<html>`:
 * - `data-ui-scale-pref` = `auto | 1 | 2 | 3` — the player's wish; the shell
 *   (agent S, `--ui-scale`) honours it instead of its own guess when not auto.
 * - `--ui-text` = 0.9 / 1 / 1.15 and `data-text` = `s | m | l` — text size.
 * - `data-motion` = `reduce | full` — resolved («auto» follows the system).
 */
export const TEXT_SCALE = { s: 0.9, m: 1, l: 1.15 } as const;

/** Slider → gain: ears hear loudness roughly by the square. */
const gain = (v: number) => v * v;

function systemReduced(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Should animations be cut down right now? (for JS-driven effects). */
export function motionReduced(s: Pick<DeviceSettings, 'motion'> = useSettings.getState()): boolean {
  return s.motion === 'reduce' || (s.motion === 'auto' && systemReduced());
}

function applyAll(): void {
  const s = useSettings.getState();
  setVolumes({ master: gain(s.master), music: gain(s.music), sfx: gain(s.sfx) });
  const el = document.documentElement;
  el.dataset.uiScalePref = String(s.uiScale);
  el.dataset.text = s.textSize;
  el.style.setProperty('--ui-text', String(TEXT_SCALE[s.textSize]));
  el.dataset.motion = motionReduced(s) ? 'reduce' : 'full';
}

let started = false;

export function startSettings(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  applyAll();
  useSettings.subscribe(applyAll);
  try {
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyAll);
  } catch {
    /* old webview */
  }
  // Vibration: one global switch for every screen, following the synced pref.
  setHapticsMuted(!useFinanceStore.getState().slotsHaptics);
  useFinanceStore.subscribe((st, prev) => {
    if (st.slotsHaptics !== prev.slotsHaptics) setHapticsMuted(!st.slotsHaptics);
  });
}
