/**
 * Camp data names in the current language (area `campData`, generated from
 * `src/lib/prison.ts`, `pets.ts`, `forest.ts`). Finds, achievements and book
 * titles are T1's (`data-mine.ts`). The lib keeps its Russian names
 * for the logic and tests; `campData.test.ts` checks the Russian catalog
 * equals them.
 */
import { t } from './core';
import type { Key } from './core';
import { AXES, SPECIES } from '@/lib/forest';
import type { AxeEnchId } from '@/lib/forest';

const k = (s: string) => s as Key;

export const handleName = (id: string) => t(k(`campData.handle.${id}`));
/** Axe by its index in `AXES` (the save keeps the index). */
export const axeName = (i: number) => t(k(`campData.axe.${AXES[i]?.id}`));
/** Tree species by index in `SPECIES`. */
export const speciesName = (i: number) => t(k(`campData.species.${SPECIES[i]?.id}.name`));
/** The wood form that goes after «boards» in this language (ru «берёзы», en «birch», de «aus Birke»). */
export const woodOf = (i: number) => t(k(`campData.species.${SPECIES[i]?.id}.gen`));
export const axeEnchName = (id: AxeEnchId) => t(k(`campData.axeEnch.${id}.name`));
export const axeEnchPer = (id: AxeEnchId) => t(k(`campData.axeEnch.${id}.per`));
export const benchName = (id: string) => t(k(`campData.bench.${id}.name`));
export const benchWho = (id: string) => t(k(`campData.bench.${id}.who`));
