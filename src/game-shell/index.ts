// Каркас форматов игры — см. API.md агента S и .claude/rules/game-shell-input.md.

export {
  classifyFormFactor,
  uiScaleFor,
  isGameRoute,
  GAME_ROUTES,
  FORM_FACTORS,
  type FormFactor,
  type UiScalePref,
} from './form-factor';
export {
  useFormFactor,
  getShellState,
  subscribeShell,
  refreshShell,
  getUiScalePref,
  setUiScalePref,
  type ShellState,
} from './shell-state';
export {
  GameScreen,
  GameNav,
  type GameScreenProps,
  type GameNavItem,
  type GameNavProps,
} from './GameScreen';
export { GameShellRoot } from './GameShellRoot';
