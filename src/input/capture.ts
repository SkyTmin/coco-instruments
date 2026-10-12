// Переназначение: «нажмите клавишу» — ждём следующую клавишу или кнопку
// геймпада. Esc отменяет, через 10 с без нажатия — тоже.

import { chordOf } from './actions';
import { setPadCapture } from './gamepad';
import { setKeyCapture } from './keyboard';

export type Captured = { device: 'keys'; chord: string } | { device: 'pad'; button: number };

const MODIFIERS = [
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
];

/**
 * Ждать следующее нажатие. `device` — какое устройство слушать (оба по
 * умолчанию). Промис даёт null при отмене (Esc, `cancel()`, таймаут 10 с).
 */
export function captureNextBinding(device: 'keys' | 'pad' | 'any' = 'any'): {
  promise: Promise<Captured | null>;
  cancel: () => void;
} {
  let done: (v: Captured | null) => void = () => {};
  const promise = new Promise<Captured | null>((res) => (done = res));
  let timer = 0;
  const finish = (v: Captured | null) => {
    window.clearTimeout(timer);
    setKeyCapture(null);
    setPadCapture(null);
    done(v);
  };
  // Отпускание пойманной клавиши тоже съедаем: иначе Escape/Пробел/Enter
  // долетят до экрана уже после перехвата.
  const finishKey = (code: string, v: Captured | null) => {
    finish(v);
    setKeyCapture((e) => {
      if (e.code !== code) return false;
      if (e.type === 'keydown' && e.repeat) return true;
      setKeyCapture(null); // отпустили (или окно теряло фокус и это новое нажатие)
      return e.type === 'keyup';
    });
  };
  if (device !== 'pad')
    setKeyCapture((e) => {
      if (e.type !== 'keydown' || e.repeat) return true;
      if (e.code === 'Escape') {
        finishKey(e.code, null);
        return true;
      }
      // Одиночный Shift — тоже клавиша (рывок), а Shift с буквой — сочетание.
      if (MODIFIERS.includes(e.code)) {
        if (!e.code.startsWith('Shift')) return true;
        finishKey(e.code, { device: 'keys', chord: e.code });
        return true;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return true;
      finishKey(e.code, { device: 'keys', chord: chordOf(e) });
      return true;
    });
  else
    setKeyCapture((e) => {
      if (e.code === 'Escape' && e.type === 'keydown') finishKey(e.code, null);
      return true;
    });
  if (device !== 'keys')
    setPadCapture((button) => {
      finish({ device: 'pad', button });
      return true;
    });
  timer = window.setTimeout(() => finish(null), 10_000);
  return { promise, cancel: () => finish(null) };
}
