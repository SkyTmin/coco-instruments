// Шина действий: клавиатура и геймпад пишут сюда, экраны слушают отсюда.
// Обработчики — стеком: позже подписанный (окно поверх страницы) первым
// получает событие и может его съесть (вернуть true).

import type { Action } from './actions';

export type InputSource = 'keyboard' | 'gamepad' | 'synthetic';
export type ActionPhase = 'down' | 'up' | 'repeat';

export interface ActionEvent {
  action: Action;
  phase: ActionPhase;
  source: InputSource;
  /** Клавиатурное событие, если оно есть (для preventDefault и цели). */
  native?: KeyboardEvent;
}

/** Вернуть true — событие съедено: дальше по стеку не идёт, у клавиши
 *  отменяется действие браузера (прокрутка пробелом, Tab по фокусу). */
export type ActionHandler = (e: ActionEvent) => boolean | void;

const handlers: ActionHandler[] = [];

export function onAction(h: ActionHandler): () => void {
  handlers.push(h);
  return () => {
    const i = handlers.lastIndexOf(h);
    if (i >= 0) handlers.splice(i, 1);
  };
}

// ---- Удержание ------------------------------------------------------------
// Действие зажато, пока его держит хоть один источник (клавиша, кнопка).

const held = new Map<Action, Set<string>>();

export function isHeld(a: Action): boolean {
  return (held.get(a)?.size ?? 0) > 0;
}

/** Отправить событие. `holder` — кто держит (код клавиши, `pad:0`). */
export function emitAction(
  action: Action,
  phase: ActionPhase,
  source: InputSource,
  native?: KeyboardEvent,
  holder?: string,
): boolean {
  if (holder) {
    let set = held.get(action);
    if (!set) held.set(action, (set = new Set()));
    if (phase === 'down') set.add(holder);
    // Отпускание того, что не было нажато (клавиша зажата в поле ввода), —
    // не событие.
    else if (phase === 'up' && !set.delete(holder)) return false;
  }
  if (
    action === 'moveUp' ||
    action === 'moveDown' ||
    action === 'moveLeft' ||
    action === 'moveRight'
  )
    pushAxis();
  const ev: ActionEvent = { action, phase, source, native };
  for (let i = handlers.length - 1; i >= 0; i--) {
    const h = handlers[i];
    if (h && h(ev) === true) return true;
  }
  return false;
}

/** Отпустить всё (окно потеряло фокус: keyup так и не придёт). */
export function releaseAll(source?: InputSource): void {
  for (const [a, set] of held) {
    if (!set.size) continue;
    const drop = [...set].filter(
      (h) => !source || h.startsWith(source === 'gamepad' ? 'pad:' : 'key:'),
    );
    if (!drop.length) continue;
    for (const h of drop) set.delete(h);
    if (!set.size) emitAction(a, 'up', source ?? 'synthetic');
  }
  if (!source || source === 'gamepad') padAxis = { x: 0, y: 0 };
  pushAxis();
}

// ---- Ось движения ---------------------------------------------------------
// Клавиши/крестовина дают 8 направлений длиной 1, стик — аналог (с мёртвой
// зоной). Зажата клавиша — побеждает она, иначе стик.

export interface Axis {
  x: number;
  y: number;
}

let padAxis: Axis = { x: 0, y: 0 };
let lastAxis: Axis = { x: 0, y: 0 };
const axisSubs = new Set<(a: Axis) => void>();

export function getMoveAxis(): Axis {
  const x = (isHeld('moveRight') ? 1 : 0) - (isHeld('moveLeft') ? 1 : 0);
  const y = (isHeld('moveDown') ? 1 : 0) - (isHeld('moveUp') ? 1 : 0);
  if (x || y) {
    const l = Math.hypot(x, y);
    return { x: x / l, y: y / l };
  }
  return { ...padAxis };
}

export function setPadAxis(x: number, y: number): void {
  padAxis = { x, y };
  pushAxis();
}

function pushAxis(): void {
  const a = getMoveAxis();
  if (Math.abs(a.x - lastAxis.x) < 1e-3 && Math.abs(a.y - lastAxis.y) < 1e-3) return;
  lastAxis = a;
  for (const fn of axisSubs) fn(a);
}

/** Слушать ось движения (зовётся только при изменении). */
export function onMoveAxis(fn: (a: Axis) => void): () => void {
  axisSubs.add(fn);
  return () => axisSubs.delete(fn);
}

// ---- Захват игрой -----------------------------------------------------------
// Пока идёт бой/ходьба, стрелки и крестовина — это движение, а не фокус по
// кнопкам: навигация по фокусу молчит, «B» геймпада не закрывает экран.

let captures = 0;

export function pushGameplayCapture(): () => void {
  captures++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    captures = Math.max(0, captures - 1);
  };
}

export function isGameplayCaptured(): boolean {
  return captures > 0;
}

/** Только для тестов. */
export function __resetBus(): void {
  handlers.length = 0;
  held.clear();
  padAxis = { x: 0, y: 0 };
  lastAxis = { x: 0, y: 0 };
  axisSubs.clear();
  captures = 0;
}
