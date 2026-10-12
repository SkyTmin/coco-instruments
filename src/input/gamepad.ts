// Геймпад → шина действий. Gamepad API не шлёт событий о кнопках — его
// опрашивают каждый кадр, пока подключён хоть один. Стандартная раскладка
// (`mapping === 'standard'`), мёртвая зона стика, повтор направлений.

import { actionsForButton, REPEATING, type Action } from './actions';
import { getBindings } from './bindings';
import { emitAction, releaseAll, setPadAxis } from './bus';
import { padStyleOf, setInputDevice } from './device';

/** Радиальная мёртвая зона левого стика (доля хода). */
export const DEADZONE = 0.24;
/** Стик как крестовина в меню — с этой доли хода. */
export const STICK_DIR = 0.55;
/** Первый повтор и шаг повтора удержанного направления, мс. */
export const REPEAT_DELAY = 380;
export const REPEAT_EVERY = 110;

/** Мёртвая зона с пересчётом: за ней ход снова идёт от 0 до 1. */
export function applyDeadzone(x: number, y: number, dz = DEADZONE): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m <= dz) return { x: 0, y: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return { x: x * k, y: y * k };
}

type PadLike = Pick<Gamepad, 'id' | 'index' | 'connected' | 'mapping' | 'axes' | 'buttons'>;

function readPads(): PadLike[] {
  try {
    const list = typeof navigator !== 'undefined' && navigator.getGamepads?.();
    if (!list) return [];
    return Array.from(list).filter((p): p is Gamepad => !!p && p.connected);
  } catch {
    return [];
  }
}

const STICK_HOLDERS: Record<'up' | 'down' | 'left' | 'right', number> = {
  up: 100,
  down: 101,
  left: 102,
  right: 103,
};

/**
 * Один опрос — `step(now)`. Отдельным классом, чтобы тест гонял его руками
 * с поддельным `navigator.getGamepads`.
 */
export class GamepadPoller {
  /** Нажатые «кнопки» (настоящие 0–16 и стик-направления 100–103). */
  private down = new Set<number>();
  /** Первый опрос только запоминает, что уже зажато: кнопка, зажатая до
   *  запуска (или до перехода), — не новое нажатие. */
  private primed = false;
  private nextRepeat = new Map<number, number>();

  step(now: number): void {
    const pads = readPads();
    const pressed = new Set<number>();
    let sx = 0;
    let sy = 0;
    let active: PadLike | null = null;
    for (const p of pads) {
      p.buttons.forEach((b, i) => {
        if (b && (b.pressed || b.value > 0.5)) {
          pressed.add(i);
          active = p;
        }
      });
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > Math.hypot(sx, sy)) {
        sx = ax;
        sy = ay;
      }
    }
    const stick = applyDeadzone(sx, sy);
    if (stick.x || stick.y) active = active ?? pads[0] ?? null;
    // Стик как крестовина для меню: только явное направление.
    if (Math.abs(sx) > STICK_DIR || Math.abs(sy) > STICK_DIR) {
      if (Math.abs(sx) > Math.abs(sy))
        pressed.add(sx > 0 ? STICK_HOLDERS.right : STICK_HOLDERS.left);
      else pressed.add(sy > 0 ? STICK_HOLDERS.down : STICK_HOLDERS.up);
    }
    if (active) setInputDevice('gamepad', padStyleOf((active as PadLike).id));

    if (!this.primed) {
      this.primed = true;
      for (const i of pressed) this.down.add(i);
    }
    for (const i of pressed) {
      if (this.down.has(i)) continue;
      this.down.add(i);
      this.nextRepeat.set(i, now + REPEAT_DELAY);
      for (const a of this.actionsOf(i)) emitAction(a, 'down', 'gamepad', undefined, `pad:${i}`);
    }
    for (const i of [...this.down]) {
      if (pressed.has(i)) continue;
      this.down.delete(i);
      this.nextRepeat.delete(i);
      for (const a of this.actionsOf(i)) emitAction(a, 'up', 'gamepad', undefined, `pad:${i}`);
    }
    for (const i of this.down) {
      const at = this.nextRepeat.get(i) ?? Infinity;
      if (now < at) continue;
      this.nextRepeat.set(i, now + REPEAT_EVERY);
      for (const a of this.actionsOf(i))
        if (REPEATING.has(a)) emitAction(a, 'repeat', 'gamepad', undefined, `pad:${i}`);
    }
    setPadAxis(stick.x, stick.y);
  }

  /** Сколько геймпадов видно (для цикла опроса). */
  connected(): number {
    return readPads().length;
  }

  reset(): void {
    this.primed = false;
    this.down.clear();
    this.nextRepeat.clear();
    releaseAll('gamepad');
  }

  private actionsOf(i: number): Action[] {
    if (i >= 100) {
      // Стик в меню — направления интерфейса, не движение (движение — ось).
      const dir = (['up', 'down', 'left', 'right'] as const)[i - 100];
      return dir ? [dir] : [];
    }
    return actionsForButton(getBindings(), i);
  }
}

let capture: ((button: number) => boolean) | null = null;
/** Перехват следующей кнопки (экран переназначения). */
export function setPadCapture(fn: ((button: number) => boolean) | null): void {
  capture = fn;
}

/** Запустить опрос: цикл кадров крутится, только пока геймпад подключён. */
export function installGamepad(): () => void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.getGamepads)
    return () => {};
  const poller = new GamepadPoller();
  let raf = 0;
  let stopped = false;
  const prevButtons = new Set<number>();
  const loop = (t: number) => {
    raf = 0;
    if (stopped) return;
    if (capture) {
      // Режим переназначения: первая новая кнопка уходит в перехват.
      const pads = readPads();
      const now = new Set<number>();
      for (const p of pads) p.buttons.forEach((b, i) => b?.pressed && now.add(i));
      for (const i of now) if (!prevButtons.has(i) && capture(i)) break;
      prevButtons.clear();
      for (const i of now) prevButtons.add(i);
    } else poller.step(t);
    if (poller.connected() > 0 && !document.hidden) raf = requestAnimationFrame(loop);
    else poller.reset();
  };
  const kick = () => {
    if (!raf && !stopped) raf = requestAnimationFrame(loop);
  };
  const onDisconnect = () => {
    if (poller.connected() === 0) poller.reset();
  };
  window.addEventListener('gamepadconnected', kick);
  window.addEventListener('gamepaddisconnected', onDisconnect);
  document.addEventListener('visibilitychange', kick);
  kick();
  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('gamepadconnected', kick);
    window.removeEventListener('gamepaddisconnected', onDisconnect);
    document.removeEventListener('visibilitychange', kick);
  };
}
