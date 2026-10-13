import { cash } from './cash';
import { common } from './common';
import { field } from './field';
import { hall } from './hall';
import { input } from './input';
import { nursery } from './nursery';
import { mine } from './mine';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';
import { slots } from './slots';
import { ui } from './ui';

/**
 * The Russian catalog — source of truth for every language. One file per
 * area; add an area here AND in every `<lang>/index.ts` (tsc enforces it).
 */
export const ru = {
  cash,
  common,
  field,
  hall,
  input,
  nursery,
  mine,
  pets,
  settings,
  skins,
  slots,
  ui,
} as const;
