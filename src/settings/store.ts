import { create } from 'zustand';

/**
 * Device settings of the game: volumes and display. Per device on purpose —
 * a phone and a laptop want different scale and loudness. Saved in
 * localStorage. The on/off switches for sound, music and vibration stay in
 * the synced app store (`slotsSound`/`slotsMusic`/`slotsHaptics`), as before.
 * The language lives in `src/i18n` (`coco.lang`).
 */
export type UiScalePref = 'auto' | 1 | 2 | 3;
export type TextSize = 's' | 'm' | 'l';
export type MotionPref = 'auto' | 'reduce' | 'full';

export interface DeviceSettings {
  /** Volumes 0…1 (slider position; the curve to gain is in `apply.ts`). */
  master: number;
  music: number;
  sfx: number;
  uiScale: UiScalePref;
  textSize: TextSize;
  motion: MotionPref;
}

export const DEFAULTS: DeviceSettings = {
  master: 1,
  music: 1,
  sfx: 1,
  uiScale: 'auto',
  textSize: 'm',
  motion: 'auto',
};

const KEY = 'coco.settings.v1';

const clamp01 = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d;

/** Anything from storage → valid settings (old/foreign values fall back to defaults). */
export function sanitize(raw: unknown): DeviceSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    Record<keyof DeviceSettings, unknown>
  >;
  return {
    master: clamp01(r.master, DEFAULTS.master),
    music: clamp01(r.music, DEFAULTS.music),
    sfx: clamp01(r.sfx, DEFAULTS.sfx),
    uiScale: ([1, 2, 3, 'auto'] as const).includes(r.uiScale as UiScalePref)
      ? (r.uiScale as UiScalePref)
      : DEFAULTS.uiScale,
    textSize: (['s', 'm', 'l'] as const).includes(r.textSize as TextSize)
      ? (r.textSize as TextSize)
      : DEFAULTS.textSize,
    motion: (['auto', 'reduce', 'full'] as const).includes(r.motion as MotionPref)
      ? (r.motion as MotionPref)
      : DEFAULTS.motion,
  };
}

function load(): DeviceSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULTS };
  }
}

interface SettingsStore extends DeviceSettings {
  set: (patch: Partial<DeviceSettings>) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...(typeof window === 'undefined' ? DEFAULTS : load()),
  set: (patch) => {
    set(sanitize({ ...get(), ...patch }));
    try {
      const { set: _omit, ...data } = get();
      void _omit;
      window.localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* private mode */
    }
  },
}));
