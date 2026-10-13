// Привязки игрока: localStorage этого устройства (клавиатура и геймпад —
// вещь устройства, а не аккаунта). API для экрана настроек.

import { DEFAULT_BINDINGS, normalizeBindings, type Bindings } from './actions';

const KEY = 'input.bindings.v1';

let current: Bindings = load();
const subs = new Set<(b: Bindings) => void>();

function load(): Bindings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return normalizeBindings(raw ? JSON.parse(raw) : DEFAULT_BINDINGS);
  } catch {
    return normalizeBindings(DEFAULT_BINDINGS);
  }
}

/** Текущие привязки (объект не мутировать — менять через setBindings). */
export function getBindings(): Bindings {
  return current;
}

/** Заменить привязки целиком или частично (недостающее — по умолчанию). */
export function setBindings(next: Partial<Bindings>): void {
  current = normalizeBindings({ ...current, ...next });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* приватный режим — живём без сохранения */
  }
  for (const fn of subs) fn(current);
}

/** Вернуть всё как было. */
export function resetBindings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* нечего удалять */
  }
  current = normalizeBindings(DEFAULT_BINDINGS);
  for (const fn of subs) fn(current);
}

export function subscribeBindings(fn: (b: Bindings) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
