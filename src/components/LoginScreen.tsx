import { useEffect, useRef, useState } from 'react';

// The bot whose Login Widget authenticates website visitors. Must match the
// domain set in @BotFather (/setdomain coco-instruments.ru).
const BOT_USERNAME = 'coco_instruments_bot';

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/**
 * Shown when the app is opened in a normal browser (the website) and there's no
 * session yet. Renders Telegram's "Log in with Telegram" widget; on success we
 * exchange the signed payload for a session cookie and reload into the app.
 */
export function LoginScreen() {
  const slot = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Match the login card to the OS colour scheme.
    const dark =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';

    // The widget invokes this global with the verified user payload.
    const w = window as unknown as { onTelegramAuth?: (user: TelegramUser) => void };
    w.onTelegramAuth = async (user) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(user),
        });
        if (!res.ok) throw new Error('auth_failed');
        location.reload();
      } catch {
        setBusy(false);
        setError('Не удалось войти. Попробуйте ещё раз.');
      }
    };

    const host = slot.current;
    if (host && !host.querySelector('script')) {
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://telegram.org/js/telegram-widget.js?22';
      s.setAttribute('data-telegram-login', BOT_USERNAME);
      s.setAttribute('data-size', 'large');
      s.setAttribute('data-radius', '12');
      s.setAttribute('data-onauth', 'onTelegramAuth(user)');
      s.setAttribute('data-request-access', 'write');
      host.appendChild(s);
    }

    return () => {
      delete w.onTelegramAuth;
    };
  }, []);

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__logo" aria-hidden>
          🥥
        </div>
        <h1 className="login__title">Coco Instruments</h1>
        <p className="login__sub">Личные инструменты: финансы, заметки, люди, гардероб.</p>
        {busy ? (
          <div className="login__busy">Входим…</div>
        ) : (
          <div className="login__widget" ref={slot} />
        )}
        {error && <div className="login__error">{error}</div>}
        <p className="login__hint">Вход через Telegram — быстро и без пароля.</p>
      </div>
    </div>
  );
}
