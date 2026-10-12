import { common } from './common';
import { settings } from './settings';

/**
 * The Russian catalog — source of truth for every language. One file per
 * area; add an area here AND in every `<lang>/index.ts` (tsc enforces it).
 */
export const ru = {
  common,
  settings,
} as const;
