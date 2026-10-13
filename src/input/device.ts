// Последнее устройство ввода → `data-input` на <html> (touch | mouse |
// keyboard | gamepad) и `data-pad` (xbox | ps | nintendo) — по ним
// переключаются подсказки кнопок и подсказки по наведению.

export type InputDevice = 'touch' | 'mouse' | 'keyboard' | 'gamepad';
export type PadStyle = 'xbox' | 'ps' | 'nintendo';

let device: InputDevice = initialDevice();
let pad: PadStyle = 'xbox';
const subs = new Set<() => void>();

function initialDevice(): InputDevice {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return 'touch';
  } catch {
    /* нет matchMedia — считаем мышью */
  }
  return typeof window === 'undefined' ? 'touch' : 'mouse';
}

export function getInputDevice(): InputDevice {
  return device;
}

export function getPadStyle(): PadStyle {
  return pad;
}

/** Стиль подписей по `Gamepad.id`: Sony — фигуры, Nintendo — буквы
 *  наоборот, всё остальное (XInput, 8BitDo в X-режиме, неизвестные) — Xbox. */
export function padStyleOf(id: string): PadStyle {
  const s = id.toLowerCase();
  if (/xbox|xinput|045e/.test(s)) return 'xbox';
  if (/054c|playstation|dualsense|dualshock|wireless controller/.test(s)) return 'ps';
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return 'nintendo';
  return 'xbox';
}

let later = 0;
const notify = () => {
  later = 0;
  apply();
  for (const fn of subs) fn();
};

/** `defer` (a pointer press): `getInputDevice()` changes now, but `data-input` and the React
 *  subscribers (every key prompt re-renders) only after the next frame. Flipping the root
 *  attribute restyles the whole page (~40 ms at 4× CPU throttle) and the prompt renders add
 *  ~50 ms: the first tap after a key press showed its pressed look 60–120 ms late (Nursery
 *  critic, round 2, P1-7). */
export function setInputDevice(d: InputDevice, padStyle?: PadStyle, defer = false): void {
  const changed = d !== device || (padStyle !== undefined && padStyle !== pad);
  device = d;
  if (padStyle) pad = padStyle;
  if (!changed) return;
  if (!defer || typeof requestAnimationFrame !== 'function') {
    notify();
    return;
  }
  if (!later) later = requestAnimationFrame(() => setTimeout(notify, 0));
}

export function subscribeInputDevice(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

function apply(): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.dataset.input = device;
  html.dataset.pad = pad;
}

/** Слушать указатель и клавиатуру (клавиатуру и геймпад отмечают их модули,
 *  здесь — страховка). Возвращает отписку. */
export function installDeviceTracking(): () => void {
  apply();
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      // Мышь — только настоящим движением: браузер шлёт синтетический
      // mousemove после прокрутки клавиатурой.
      if (e.type === 'pointermove' && !e.movementX && !e.movementY) return;
      setInputDevice('mouse', undefined, true);
    } else setInputDevice('touch', undefined, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Unidentified') return;
    setInputDevice('keyboard');
  };
  window.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('pointermove', onPointer, { capture: true, passive: true });
  window.addEventListener('keydown', onKey, true);
  return () => {
    window.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('pointermove', onPointer, true);
    window.removeEventListener('keydown', onKey, true);
  };
}
