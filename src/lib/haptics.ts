import { hapticFeedback } from '@tma.js/sdk-react';

// Thin, crash-proof wrappers around Telegram haptics. Each is a no-op when the
// feature isn't available (e.g. desktop, or in the browser mock) — или когда
// игрок выключил вибрацию в настройках.

let muted = false;

/** Глобальный выключатель вибрации (настройка в слотах). */
export function setHapticsMuted(value: boolean): void {
  muted = value;
}

export function tapLight(): void {
  if (muted) return;
  try {
    if (hapticFeedback.impactOccurred.isAvailable()) hapticFeedback.impactOccurred('light');
  } catch {
    /* no-op */
  }
}

export function tapMedium(): void {
  if (muted) return;
  try {
    if (hapticFeedback.impactOccurred.isAvailable()) hapticFeedback.impactOccurred('medium');
  } catch {
    /* no-op */
  }
}

export function notifySuccess(): void {
  if (muted) return;
  try {
    if (hapticFeedback.notificationOccurred.isAvailable())
      hapticFeedback.notificationOccurred('success');
  } catch {
    /* no-op */
  }
}

export function notifyWarning(): void {
  if (muted) return;
  try {
    if (hapticFeedback.notificationOccurred.isAvailable())
      hapticFeedback.notificationOccurred('warning');
  } catch {
    /* no-op */
  }
}

export function selectionChanged(): void {
  if (muted) return;
  try {
    if (hapticFeedback.selectionChanged.isAvailable()) hapticFeedback.selectionChanged();
  } catch {
    /* no-op */
  }
}
