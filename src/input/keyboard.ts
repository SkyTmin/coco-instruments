// Клавиатура → шина действий. Поля ввода не трогаем (кроме Esc — им
// «Назад» снимает фокус с поля), Ctrl/Alt/Cmd — тоже.

import { actionsForCode, actionsForKey, REPEATING } from './actions';
import { getBindings } from './bindings';
import { emitAction, releaseAll } from './bus';
import { setInputDevice } from './device';

/** Цель — поле, куда печатают: там клавиши принадлежат тексту. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'color'].includes(type);
}

let capture: ((e: KeyboardEvent) => boolean) | null = null;

/** Перехват следующей клавиши (экран переназначения). Вернуть true — съел. */
export function setKeyCapture(fn: ((e: KeyboardEvent) => boolean) | null): void {
  capture = fn;
}

export function installKeyboard(): () => void {
  const down = (e: KeyboardEvent) => {
    if (capture && capture(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.isComposing) return;
    setInputDevice('keyboard');
    if (isTypingTarget(e.target) && e.code !== 'Escape') return;
    const acts = actionsForKey(getBindings(), e);
    let eaten = false;
    for (const a of acts) {
      if (e.repeat) {
        if (!REPEATING.has(a)) continue;
        if (emitAction(a, 'repeat', 'keyboard', e)) eaten = true;
      } else if (emitAction(a, 'down', 'keyboard', e, `key:${e.code}`)) eaten = true;
    }
    if (eaten) e.preventDefault();
  };
  const up = (e: KeyboardEvent) => {
    for (const a of actionsForCode(getBindings(), e.code))
      emitAction(a, 'up', 'keyboard', e, `key:${e.code}`);
  };
  const blur = () => releaseAll('keyboard');
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
  };
}
