import { common } from './common';
import { hall } from './hall';
import { input } from './input';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';

/**
 * The Russian catalog — source of truth for every language. One file per
 * area; add an area here AND in every `<lang>/index.ts` (tsc enforces it).
 */
export const ru = {
  common,
  hall,
  input,
  pets,
  settings,
  skins,
} as const;
