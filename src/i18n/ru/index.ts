import { common } from './common';
import { field } from './field';
import { hall } from './hall';
import { mine } from './mine';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';
import { ui } from './ui';

/**
 * The Russian catalog — source of truth for every language. One file per
 * area; add an area here AND in every `<lang>/index.ts` (tsc enforces it).
 */
export const ru = {
  common,
  field,
  hall,
  mine,
  pets,
  settings,
  skins,
  ui,
} as const;
