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
