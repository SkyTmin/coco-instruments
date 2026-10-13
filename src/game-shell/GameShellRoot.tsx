// Корень каркаса: на игровых маршрутах ставит на <html> `data-ff` (формат),
// `data-game`, `--ui-scale`/`--ui-px` и отключает прокрутку страницы
// (прокручивается #root, без «резинки»). Слушает
// resize, поворот, visualViewport и вьюпорт Telegram.

import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isTMA, postEvent, viewport } from '@tma.js/sdk-react';
import { isGameRoute } from './form-factor';
import { refreshShell, setShellGame, useFormFactor } from './shell-state';
import { TipHost } from './TipHost';
import './game-shell.css';

/** Telegram: телефон поворачивается вместе с игрой (замок снят явно —
 *  на случай, если клиент запомнил его с прошлого запуска). */
function unlockOrientation(): void {
  try {
    if (!isTMA()) return;
    postEvent('web_app_toggle_orientation_lock', { locked: false });
  } catch {
    /* старый клиент без метода — он и так не держит ориентацию */
  }
}

export function GameShellRoot() {
  const { pathname } = useLocation();
  const game = isGameRoute(pathname);
  const s = useFormFactor();

  useEffect(() => {
    const on = () => refreshShell();
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    window.visualViewport?.addEventListener('resize', on);
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(orientation: portrait)');
      mq.addEventListener('change', on);
    } catch {
      mq = null;
    }
    // Вьюпорт Telegram монтируется асинхронно (init.ts) — подписка, когда
    // смонтирован: смена полноэкранного режима и безопасных зон.
    const offs: (() => void)[] = [];
    try {
      offs.push(viewport.state.sub(on));
      offs.push(viewport.isFullscreen.sub(on));
    } catch {
      /* вне Telegram сигналов нет */
    }
    unlockOrientation();
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
      window.visualViewport?.removeEventListener('resize', on);
      mq?.removeEventListener('change', on);
      offs.forEach((off) => off());
    };
  }, []);

  useLayoutEffect(() => {
    setShellGame(game);
    const html = document.documentElement;
    if (game) {
      html.dataset.game = '';
      html.dataset.ff = s.ff;
      html.style.setProperty('--ui-scale', String(s.scale));
      html.style.setProperty('--ui-px', `${s.scale}px`);
    } else {
      delete html.dataset.game;
      delete html.dataset.ff;
      html.style.removeProperty('--ui-scale');
      html.style.removeProperty('--ui-px');
    }
  }, [game, s.ff, s.scale]);

  // Вход в игру: документ больше не прокручивается — вернуть его в начало,
  // иначе страница так и останется сдвинутой без способа вернуться. Новый
  // экран игры — с начала.
  useLayoutEffect(() => {
    if (game) {
      const se = document.scrollingElement as HTMLElement | null;
      if (se && se.scrollTop) se.scrollTop = 0;
    }
    const root = document.getElementById('root');
    if (root && root.scrollTop) root.scrollTop = 0;
  }, [game, pathname]);

  return game ? <TipHost /> : null;
}
