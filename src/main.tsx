// Telegram UI styles first so our theme.css can override where needed.
import '@telegram-apps/telegram-ui/dist/styles.css';
import './theme.css';

// Mock the Telegram env in dev (no-op / tree-shaken in production).
import './mockEnv';

import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { retrieveLaunchParams } from '@tma.js/sdk-react';

import { Root } from '@/Root';
import { WebApp } from '@/App';
import { LoginScreen } from '@/components/LoginScreen';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { init } from '@/init';
import { setWebAuth } from '@/lib/storage';
import { setWebMode } from '@/lib/runtime';
import { installGlobalErrorLogging } from '@/lib/log';

installGlobalErrorLogging();

// --- App freshness (fixes stale PWA + "not a valid JS MIME type" on iOS) -----
// Home-screen PWAs can hold an old app shell across deploys. Nudge the service
// worker to check for a new build whenever the app is re-opened, and reload once
// when a new worker takes control. Also recover from a stale chunk (an old
// hashed import that 404s after a deploy) by reloading to the fresh shell.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return; // ignore the first install's claim
    refreshing = true;
    window.location.reload();
  });
  const checkForUpdate = () => {
    void navigator.serviceWorker.getRegistration().then((reg) => reg?.update());
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  window.addEventListener('focus', checkForUpdate);
}

// A dynamic import failing (a stale chunk after a deploy) → reload once to the
// fresh shell instead of crashing with a MIME/parse error.
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('coco.staleReload')) return;
  try {
    sessionStorage.setItem('coco.staleReload', '1');
  } catch {
    /* private mode */
  }
  window.location.reload();
});
// Clear the one-shot guard once the app has been running a few seconds, so a
// later stale chunk can recover too (without risking a reload loop).
setTimeout(() => {
  try {
    sessionStorage.removeItem('coco.staleReload');
  } catch {
    /* ignore */
  }
}, 6000);

const root = ReactDOM.createRoot(document.getElementById('root')!);

// Telegram Desktop sometimes loads the page before the launch params are in
// place on a cold start — previously that meant the "open in Telegram" gate
// until the user reloaded by hand. Give the params a moment, then reload
// ourselves once before giving up.
const BOOT_RETRY_KEY = 'coco.bootRetried';

async function retrieveLaunchParamsWithGrace() {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return retrieveLaunchParams();
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return null;
}

const lp = await retrieveLaunchParamsWithGrace();

// Are we inside a Telegram client at all? Telegram injects window.Telegram.WebApp;
// a normal browser doesn't — that's how we tell a Mini App from the website.
const inTelegramClient =
  typeof window !== 'undefined' &&
  Boolean((window as unknown as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp);

if (lp) {
  // --- Telegram Mini App ----------------------------------------------------
  try {
    sessionStorage.removeItem(BOOT_RETRY_KEY);
  } catch {
    /* private mode */
  }
  try {
    const debug = import.meta.env.DEV || `${lp.tgWebAppStartParam || ''}`.includes('debug');
    await init(debug);
    root.render(
      <StrictMode>
        <Root />
      </StrictMode>,
    );
  } catch (e) {
    root.render(
      <div className="screen">
        <div className="empty">
          <div className="empty__icon">⚠️</div>
          <div className="empty__title">Не удалось запустить приложение</div>
          <div className="empty__sub">{e instanceof Error ? e.message : String(e)}</div>
        </div>
      </div>,
    );
  }
} else if (inTelegramClient && !sessionStorage.getItem(BOOT_RETRY_KEY)) {
  // Telegram Desktop sometimes loads before the launch params are ready on a
  // cold start — reload ourselves once before giving up.
  try {
    sessionStorage.setItem(BOOT_RETRY_KEY, '1');
  } catch {
    /* private mode */
  }
  location.reload();
} else {
  // --- Website (a normal browser): log in with Telegram, then run on the web -
  setWebMode(true);
  let authed = false;
  try {
    authed = (await fetch('/api/auth/me', { credentials: 'include' })).ok;
  } catch {
    authed = false;
  }
  if (authed) {
    setWebAuth();
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <WebApp />
        </ErrorBoundary>
      </StrictMode>,
    );
  } else {
    root.render(
      <StrictMode>
        <LoginScreen />
      </StrictMode>,
    );
  }
}
