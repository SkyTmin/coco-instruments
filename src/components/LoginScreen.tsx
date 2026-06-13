import { useCallback, useEffect, useRef, useState } from 'react';

// The bot that authenticates website visitors (domain set in @BotFather).
const BOT_USERNAME = 'coco_instruments_bot';
const POLL_MS = 2000;
const GIVE_UP_MS = 5 * 60 * 1000;

type Phase = 'idle' | 'waiting' | 'error';

/**
 * Website login. Opens the Telegram app via a deep link (t.me/<bot>?start=…),
 * the user taps Start in the bot, the bot confirms server-side, and this screen
 * (polling) reloads into the app. Works on phone and desktop, no web popup.
 */
export function LoginScreen() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [link, setLink] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Match the login card to the OS colour scheme.
  useEffect(() => {
    const dark =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, []);

  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const start = useCallback(async () => {
    setPhase('waiting');
    setLink(null);
    // Reserve the popup *within* the click gesture so it isn't blocked; we point
    // it at Telegram once we have the token.
    const popup = window.open('', '_blank');
    try {
      const res = await fetch('/api/auth/start', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('start_failed');
      const { token } = (await res.json()) as { token: string };
      const tgLink = `https://t.me/${BOT_USERNAME}?start=login_${token}`;
      setLink(tgLink);
      if (popup) popup.location.href = tgLink;

      const startedAt = Date.now();
      stopPolling();
      timer.current = setInterval(() => {
        if (Date.now() - startedAt > GIVE_UP_MS) {
          stopPolling();
          setPhase('error');
          return;
        }
        void fetch(`/api/auth/poll?token=${token}`, { credentials: 'include' })
          .then((r) => r.json())
          .then((data: { status: string }) => {
            if (data.status === 'ok') {
              stopPolling();
              location.reload();
            } else if (data.status === 'expired') {
              stopPolling();
              setPhase('error');
            }
          })
          .catch(() => {
            /* transient network error — keep polling */
          });
      }, POLL_MS);
    } catch {
      if (popup) popup.close();
      stopPolling();
      setPhase('error');
    }
  }, [stopPolling]);

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__logo" aria-hidden>
          🥥
        </div>
        <h1 className="login__title">Coco Instruments</h1>
        <p className="login__sub">Личные инструменты: финансы, заметки, люди, гардероб.</p>

        {phase === 'waiting' ? (
          <div className="login__wait">
            <div className="login__spinner" aria-hidden />
            <p className="login__waittext">Подтвердите вход в приложении Telegram…</p>
            {link && (
              <a className="login__relink" href={link} target="_blank" rel="noreferrer">
                Открыть Telegram ещё раз
              </a>
            )}
          </div>
        ) : (
          <button className="login__btn" type="button" onClick={() => void start()}>
            <span className="login__btn-icon" aria-hidden>
              ✈
            </span>
            Войти через Telegram
          </button>
        )}

        {phase === 'error' && (
          <p className="login__error">Не удалось войти или ссылка устарела. Попробуйте ещё раз.</p>
        )}

        <p className="login__hint">Вход через Telegram — быстро и без пароля.</p>
      </div>
    </div>
  );
}
