// Слой действий: игра слушает «confirm», «attack», «inventory», а не клавиши.
// Клавиши и кнопки геймпада — привязки, которые игрок может переназначить
// (getBindings/setBindings — для экрана настроек). Всё здесь — чистые
// функции без DOM, их проверяет actions.test.ts.

/** Действия интерфейса: навигация по меню, окна, вкладки. */
export const UI_ACTIONS = [
  'confirm',
  'back',
  'up',
  'down',
  'left',
  'right',
  'tabPrev',
  'tabNext',
  'inspect',
  'menu',
] as const;

/** Действия игрового мира (подземелье, площадь). Ось движения — отдельно. */
export const GAME_ACTIONS = [
  'moveUp',
  'moveDown',
  'moveLeft',
  'moveRight',
  'attack',
  'dash',
  'skill',
  'eat',
  'interact',
] as const;

/** Горячие клавиши лагеря (только там, где такой экран есть). */
export const HOTKEY_ACTIONS = [
  'inventory',
  'pets',
  'forge',
  'books',
  'chests',
  'mines',
  // wave 2 — M: шахта (лагерь «Ещё», продать рюкзак, ранг, расходники 1–6)
  'camp',
  'sell',
  'rank',
  'item1',
  'item2',
  'item3',
  'item4',
  'item5',
  'item6',
] as const;

export type UiAction = (typeof UI_ACTIONS)[number];
export type GameAction = (typeof GAME_ACTIONS)[number];
export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number];
export type Action = UiAction | GameAction | HotkeyAction;

export const ACTIONS: readonly Action[] = [...UI_ACTIONS, ...GAME_ACTIONS, ...HOTKEY_ACTIONS];

/** Действия, которые повторяются при удержании (браузерный автоповтор и
 *  повтор кнопки/стика геймпада). */
export const REPEATING: ReadonlySet<Action> = new Set<Action>([
  'up',
  'down',
  'left',
  'right',
  'tabPrev',
  'tabNext',
]);

/**
 * Привязка клавиши — `KeyboardEvent.code` (физическая клавиша, не буква:
 * WASD работает и в русской раскладке), с необязательным `Shift+`.
 * Привязка геймпада — индекс кнопки в стандартной раскладке
 * (0 A/✕, 1 B/○, 2 X/□, 3 Y/△, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu,
 * 10 L3, 11 R3, 12–15 крестовина ↑↓←→, 16 Home).
 */
export interface Bindings {
  keys: Record<Action, string[]>;
  pad: Record<Action, number[]>;
}

export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  HOME: 16,
} as const;

export const DEFAULT_BINDINGS: Bindings = {
  keys: {
    confirm: ['Enter', 'Space', 'NumpadEnter'],
    back: ['Escape'],
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    tabPrev: ['Shift+Tab'],
    tabNext: ['Tab'],
    inspect: ['KeyX'],
    menu: ['KeyO'],
    moveUp: ['KeyW', 'ArrowUp'],
    moveDown: ['KeyS', 'ArrowDown'],
    moveLeft: ['KeyA', 'ArrowLeft'],
    moveRight: ['KeyD', 'ArrowRight'],
    attack: ['KeyJ', 'Space'],
    dash: ['KeyK', 'ShiftLeft', 'ShiftRight'],
    skill: ['KeyL'],
    eat: ['KeyQ'],
    interact: ['KeyE'],
    inventory: ['KeyI'],
    pets: ['KeyP'],
    forge: ['KeyF'],
    books: ['KeyB'],
    chests: ['KeyC'],
    mines: ['KeyM'],
    camp: ['KeyL'],
    sell: ['KeyE'],
    rank: ['KeyR'],
    item1: ['Digit1', 'Numpad1'],
    item2: ['Digit2', 'Numpad2'],
    item3: ['Digit3', 'Numpad3'],
    item4: ['Digit4', 'Numpad4'],
    item5: ['Digit5', 'Numpad5'],
    item6: ['Digit6', 'Numpad6'],
  },
  pad: {
    confirm: [PAD.A],
    back: [PAD.B],
    up: [PAD.UP],
    down: [PAD.DOWN],
    left: [PAD.LEFT],
    right: [PAD.RIGHT],
    tabPrev: [PAD.LB],
    tabNext: [PAD.RB],
    inspect: [PAD.Y],
    menu: [PAD.MENU],
    moveUp: [PAD.UP],
    moveDown: [PAD.DOWN],
    moveLeft: [PAD.LEFT],
    moveRight: [PAD.RIGHT],
    attack: [PAD.A, PAD.RT],
    dash: [PAD.B, PAD.LT],
    skill: [PAD.Y],
    eat: [PAD.LB],
    interact: [PAD.X],
    inventory: [PAD.VIEW],
    pets: [],
    forge: [],
    books: [],
    chests: [],
    mines: [],
    camp: [],
    sell: [PAD.X],
    rank: [PAD.Y],
    item1: [],
    item2: [],
    item3: [],
    item4: [],
    item5: [],
    item6: [],
  },
};

/** Копия привязок, дополненная значениями по умолчанию там, где их нет
 *  (старое сохранение без нового действия). Мусор отбрасывается. */
export function normalizeBindings(raw: unknown): Bindings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    Record<keyof Bindings, unknown>
  >;
  const keysIn = (src.keys && typeof src.keys === 'object' ? src.keys : {}) as Record<
    string,
    unknown
  >;
  const padIn = (src.pad && typeof src.pad === 'object' ? src.pad : {}) as Record<string, unknown>;
  const keys = {} as Record<Action, string[]>;
  const pad = {} as Record<Action, number[]>;
  for (const a of ACTIONS) {
    const k = keysIn[a];
    keys[a] = Array.isArray(k)
      ? k.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [...DEFAULT_BINDINGS.keys[a]];
    const p = padIn[a];
    pad[a] = Array.isArray(p)
      ? p.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < 32)
      : [...DEFAULT_BINDINGS.pad[a]];
  }
  return { keys, pad };
}

/** Что от клавиатурного события нужно для сопоставления. */
export interface KeyLike {
  code: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

/** Строка привязки для события: `KeyW`, `Shift+Tab`. */
export function chordOf(e: KeyLike): string {
  return e.shiftKey ? `Shift+${e.code}` : e.code;
}

/** Код клавиши из привязки: `Shift+Tab` → `Tab`. */
export function codeOfChord(chord: string): string {
  return chord.startsWith('Shift+') ? chord.slice(6) : chord;
}

/**
 * Действия, которые запускает нажатие. Ctrl/Alt/Cmd — не наше (сочетания
 * браузера и системы). Сначала точное совпадение с учётом Shift; если его нет,
 * а Shift зажат, — привязки без Shift (бежать с зажатым рывком, `Shift+W`).
 */
export function actionsForKey(b: Bindings, e: KeyLike): Action[] {
  if (e.ctrlKey || e.altKey || e.metaKey || !e.code) return [];
  const chord = chordOf(e);
  const out: Action[] = [];
  for (const a of ACTIONS) if (b.keys[a].includes(chord)) out.push(a);
  if (out.length || !e.shiftKey) return out;
  for (const a of ACTIONS) if (b.keys[a].includes(e.code)) out.push(a);
  return out;
}

/** Действия, которые отпускает клавиша (с Shift и без — она отпущена вся). */
export function actionsForCode(b: Bindings, code: string): Action[] {
  const out: Action[] = [];
  for (const a of ACTIONS) if (b.keys[a].some((c) => codeOfChord(c) === code)) out.push(a);
  return out;
}

/** Действия кнопки геймпада. */
export function actionsForButton(b: Bindings, button: number): Action[] {
  const out: Action[] = [];
  for (const a of ACTIONS) if (b.pad[a].includes(button)) out.push(a);
  return out;
}

/**
 * Переназначить одно действие. `exclusive` (по умолчанию) снимает эту же
 * клавишу с действий ТОЙ ЖЕ группы — двух «Вверх» в меню не бывает, а
 * «Пробел» одновременно «Подтвердить» в меню и «Удар» в подземелье — бывает.
 */
export function rebind(
  b: Bindings,
  action: Action,
  device: 'keys' | 'pad',
  value: string | number,
  slot = 0,
  exclusive = true,
): Bindings {
  const next = normalizeBindings(b);
  const group = groupOf(action);
  if (device === 'keys') {
    const v = String(value);
    if (exclusive)
      for (const a of ACTIONS)
        if (a !== action && groupOf(a) === group)
          next.keys[a] = next.keys[a].filter((c) => c !== v);
    const list = next.keys[action].filter((c) => c !== v);
    list.splice(Math.min(slot, list.length), 0, v);
    next.keys[action] = list;
  } else {
    const v = Number(value);
    if (exclusive)
      for (const a of ACTIONS)
        if (a !== action && groupOf(a) === group) next.pad[a] = next.pad[a].filter((c) => c !== v);
    const list = next.pad[action].filter((c) => c !== v);
    list.splice(Math.min(slot, list.length), 0, v);
    next.pad[action] = list;
  }
  return next;
}

/**
 * Поставить в ячейку `slot` новое значение ВМЕСТО старого (экран клавиш:
 * «нажми клавишу» в ячейке). `null` — стереть ячейку. Если значение было у
 * другого действия той же группы, они МЕНЯЮТСЯ: тому достаётся старое
 * значение ячейки — так ни одно действие не остаётся без клавиши молча.
 */
export function assignBinding(
  b: Bindings,
  action: Action,
  device: 'keys' | 'pad',
  value: string | number | null,
  slot = 0,
): Bindings {
  const next = normalizeBindings(b);
  if (device === 'keys') assignIn(next.keys, action, value === null ? null : String(value), slot);
  else assignIn(next.pad, action, value === null ? null : Number(value), slot);
  return next;
}

function assignIn<T extends string | number>(
  map: Record<Action, T[]>,
  action: Action,
  value: T | null,
  slot: number,
): void {
  const old = map[action][slot];
  const own = map[action].filter((_, i) => i !== slot);
  if (value === null) {
    map[action] = own;
    return;
  }
  const group = groupOf(action);
  for (const a of ACTIONS) {
    if (a === action || groupOf(a) !== group) continue;
    const i = map[a].indexOf(value);
    if (i < 0) continue;
    const rest = [...map[a]];
    if (old !== undefined && old !== value && !rest.includes(old)) rest[i] = old;
    else rest.splice(i, 1);
    map[a] = rest;
  }
  const mine = own.filter((v) => v !== value);
  mine.splice(Math.min(slot, mine.length), 0, value);
  map[action] = mine;
}

export function groupOf(a: Action): 'ui' | 'game' | 'hotkey' {
  if ((UI_ACTIONS as readonly string[]).includes(a)) return 'ui';
  if ((GAME_ACTIONS as readonly string[]).includes(a)) return 'game';
  return 'hotkey';
}

// ---- Подписи клавиш --------------------------------------------------------

const NAMED: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Num Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: '⌫',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  CapsLock: 'Caps',
  Delete: 'Del',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

/** Подпись на клавише: `KeyW` → `W`, `Shift+Tab` → `Shift+Tab`, `ArrowUp` → `↑`. */
export function keyLabel(chord: string): string {
  const shift = chord.startsWith('Shift+');
  const code = codeOfChord(chord);
  let s: string;
  if (NAMED[code]) s = NAMED[code];
  else if (/^Key[A-Z]$/.test(code)) s = code.slice(3);
  else if (/^Digit\d$/.test(code)) s = code.slice(5);
  else if (/^Numpad\d$/.test(code)) s = `Num ${code.slice(6)}`;
  else if (/^F\d{1,2}$/.test(code)) s = code;
  else s = code;
  return shift ? `Shift+${s}` : s;
}
