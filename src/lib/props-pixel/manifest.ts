// Пиксельные предметы — манифесты всех наборов для игры (`PxStrip`).
// Каждый `sprites-<set>.ts` пишет свой post.py (`scripts/props-pixel/post.py --set <set>`):
// у наборов свои файлы, и агенты разных наборов не спорят в одном месте.

import type { PxManifest, PxStripMeta } from './types';
import { PX as books } from './sprites-books';
import { PX as chests } from './sprites-chests';
import { PX as eggs } from './sprites-eggs';
import { PX as picks } from './sprites-picks';

export const PX_SETS = { eggs, chests, books, picks } satisfies Record<string, PxManifest>;
export type PxSetName = keyof typeof PX_SETS;

export function pxStrip(set: PxSetName, name: string): PxStripMeta | undefined {
  return PX_SETS[set].strips[name];
}

/** Адрес полосы: `?v=` — метка её содержимого. */
export function pxSrc(set: PxSetName, name: string, large: boolean): string {
  const st = PX_SETS[set].strips[name];
  return `/ui/px/${set}/${name}${large ? '-l' : ''}.webp?v=${st?.rev ?? '0'}`;
}
