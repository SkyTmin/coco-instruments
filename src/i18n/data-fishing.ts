/**
 * Fishing data names in the current language (area `fishingData`, generated
 * from `src/lib/fishing.ts`). The lib keeps its Russian names for the logic
 * and tests; `fishingData.test.ts` checks the Russian catalog equals them.
 * Forest names (species, axes, axe enchants) are T2's — `data-camp.ts`.
 */
import { fmtDec, t } from './core';
import type { Key } from './core';
import { SPOTS } from '@/lib/fishing';

const k = (s: string) => s as Key;

/** Spot by its index in `SPOTS` (the save keeps the index). */
export const spotName = (i: number) => t(k(`fishingData.spot.${SPOTS[i]?.id}`));
export const fishName = (id: string) => t(k(`fishingData.fish.${id}`));
/** Rod by its index in `RODS`. */
export const rodName = (i: number) => t(k(`fishingData.rod.${i}`));

/** Weight of a catch: «850 г», «2,4 кг», «12 кг» / «850 g», «2.4 kg». */
export const kgText = (kg: number) =>
  kg < 1
    ? t('fishing.g', { n: String(Math.round(kg * 1000)) })
    : t('fishing.kg', { n: fmtDec(kg, kg < 10 ? 1 : 0) });
