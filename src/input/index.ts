// Слой ввода игры — см. API.md агента S и .claude/rules/game-shell-input.md.

export {
  ACTIONS,
  UI_ACTIONS,
  GAME_ACTIONS,
  HOTKEY_ACTIONS,
  DEFAULT_BINDINGS,
  PAD,
  keyLabel,
  rebind,
  groupOf,
  type Action,
  type UiAction,
  type GameAction,
  type HotkeyAction,
  type Bindings,
} from './actions';
export { getBindings, setBindings, resetBindings, subscribeBindings } from './bindings';
export {
  onAction,
  emitAction,
  isHeld,
  getMoveAxis,
  onMoveAxis,
  isGameplayCaptured,
  pushGameplayCapture,
  type ActionEvent,
  type ActionHandler,
  type ActionPhase,
  type InputSource,
  type Axis,
} from './bus';
export {
  getInputDevice,
  getPadStyle,
  setInputDevice,
  type InputDevice,
  type PadStyle,
} from './device';
export {
  moveFocus,
  focusEl,
  firstFocusable,
  activateFocused,
  topLayer,
  inTopLayer,
  pickNeighbour,
  FOCUSABLE,
  type Box,
  type Dir,
} from './focus-nav';
export {
  useAction,
  useHotkeys,
  useMoveAxis,
  useGameplayCapture,
  useInputDevice,
  usePadStyle,
  useBindings,
  type UseActionOptions,
} from './hooks';
export { Prompt, promptText, hintTitle, type PromptAction, type PromptProps } from './Prompt';
export { captureNextBinding, type Captured } from './capture';
export { InputRoot } from './InputRoot';
