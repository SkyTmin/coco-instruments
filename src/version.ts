// App version — shown in the corner of the home screen so you can tell at a
// glance that a fresh deploy has actually loaded (vs. a cached old bundle).
//
// BUMP `APP_VERSION` on every release and mention it in the commit message.
// `__BUILD_AT__` (injected by Vite) changes on every build as an extra signal,
// so even without a bump the timestamp will differ once the new bundle loads.
export const APP_VERSION = '2.1.4';

const buildFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** e.g. "v2.1.0 · 15 июн, 19:42" — version + when this bundle was built. */
export function versionLabel(): string {
  let when = '';
  try {
    when = buildFmt.format(new Date(__BUILD_AT__));
  } catch {
    /* build time unavailable */
  }
  return when ? `v${APP_VERSION} · ${when}` : `v${APP_VERSION}`;
}
