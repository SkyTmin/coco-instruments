import { hapticFeedback } from '@tma.js/sdk-react';

// Thin, crash-proof wrappers around Telegram haptics. Each is a no-op when the
// feature isn't available (e.g. desktop, or in the browser mock).

export function tapLight(): void {
  try {
    if (hapticFeedback.impactOccurred.isAvailable()) hapticFeedback.impactOccurred('light');
  } catch {
    /* no-op */
  }
}

export function tapMedium(): void {
  try {
    if (hapticFeedback.impactOccurred.isAvailable()) hapticFeedback.impactOccurred('medium');
  } catch {
    /* no-op */
  }
}

export function notifySuccess(): void {
  try {
    if (hapticFeedback.notificationOccurred.isAvailable()) hapticFeedback.notificationOccurred('success');
  } catch {
    /* no-op */
  }
}

export function notifyWarning(): void {
  try {
    if (hapticFeedback.notificationOccurred.isAvailable()) hapticFeedback.notificationOccurred('warning');
  } catch {
    /* no-op */
  }
}

export function selectionChanged(): void {
  try {
    if (hapticFeedback.selectionChanged.isAvailable()) hapticFeedback.selectionChanged();
  } catch {
    /* no-op */
  }
}
