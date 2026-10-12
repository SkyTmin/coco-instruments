/** General game settings — public API (see `.claude/rules/i18n.md`, «Settings»). */
export { GameSettings, SectionIcon } from './GameSettings';
export type { SettingsSection } from './GameSettings';
export { useSettings, DEFAULTS as SETTINGS_DEFAULTS } from './store';
export type { DeviceSettings, UiScalePref, TextSize, MotionPref } from './store';
export { motionReduced, startSettings, TEXT_SCALE } from './apply';
export { settingsPanels } from './panels';
