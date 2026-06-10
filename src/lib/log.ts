import { getServerAuth } from '@/lib/storage';

const recent = new Map<string, number>();

/** Report a client error to the server (rotating errors.log, ships in backups).
 *  Fire-and-forget, deduped, never throws. */
export function logError(info: { kind?: string; message: string; stack?: string }): void {
  try {
    if (import.meta.env.DEV) return;
    const key = `${info.kind ?? ''}:${info.message}`;
    const now = Date.now();
    if ((recent.get(key) ?? 0) > now - 15_000) return; // dedupe bursts
    recent.set(key, now);
    void fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: info.kind ?? 'error',
        message: info.message,
        stack: info.stack ?? '',
        url: typeof location !== 'undefined' ? location.hash || location.pathname : '',
        initData: getServerAuth(),
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* logging must never break the app */
  }
}

/** Catch uncaught errors and unhandled promise rejections. */
export function installGlobalErrorLogging(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    logError({
      kind: 'window.error',
      message: String(e.message || e.error || 'error'),
      stack: e.error?.stack,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    logError({
      kind: 'unhandledrejection',
      message: String(r?.message ?? r ?? 'rejection'),
      stack: r?.stack,
    });
  });
}
