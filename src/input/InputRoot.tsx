// Корень ввода: ставит клавиатуру, геймпад и слежку за устройством и держит
// поведение по умолчанию (оно — дно стека, любой экран перекрывает его):
//   back    — снять фокус с поля → закрыть верхнее окно → шаг назад;
//   confirm — геймпад нажимает кнопку в фокусе, Enter/Пробел — div-кнопки;
//   стрелки — фокус по соседям на игровых маршрутах (вне захвата игрой);
//   menu    — в бою геймпадный Start ставит паузу (как Esc).

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { closeTopOverlay } from '@/lib/escape-stack';
import { onAction, isGameplayCaptured } from './bus';
import { installDeviceTracking } from './device';
import { activateFocused, moveFocus, type Dir } from './focus-nav';
import { installGamepad } from './gamepad';
import { installKeyboard, isTypingTarget } from './keyboard';

const NATIVE = ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY'];

/** Игровой маршрут (каркас форматов поставил `data-ff`). */
function onGameRoute(): boolean {
  return !!document.documentElement.dataset.ff;
}

export function InputRoot() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    const offs = [installDeviceTracking(), installKeyboard(), installGamepad()];
    offs.push(
      onAction((e) => {
        if (e.phase === 'up') return false;
        const captured = isGameplayCaptured();
        switch (e.action) {
          case 'back': {
            if (e.phase !== 'down') return false;
            const el = document.activeElement as HTMLElement | null;
            if (el && isTypingTarget(el)) {
              el.blur();
              return true;
            }
            // В бою «B» геймпада — рывок, а не выход.
            if (captured && e.source === 'gamepad') return false;
            if (closeTopOverlay()) return true;
            if (pathRef.current !== '/') {
              navigate(-1);
              return true;
            }
            return false;
          }
          case 'menu': {
            if (e.phase !== 'down' || !captured || e.source !== 'gamepad') return false;
            return closeTopOverlay();
          }
          case 'confirm': {
            if (e.phase !== 'down') return false;
            if (e.source === 'gamepad') return !captured && activateFocused();
            const t = e.native?.target as HTMLElement | null;
            if (
              t &&
              t.getAttribute?.('role') === 'button' &&
              !NATIVE.includes(t.tagName) &&
              !isTypingTarget(t)
            ) {
              t.click();
              return true;
            }
            return false;
          }
          case 'up':
          case 'down':
          case 'left':
          case 'right': {
            if (captured || !onGameRoute()) return false;
            if (e.native && isTypingTarget(e.native.target)) return false;
            return moveFocus(e.action as Dir);
          }
          default:
            return false;
        }
      }),
    );
    return () => offs.forEach((off) => off());
  }, [navigate]);

  return null;
}
