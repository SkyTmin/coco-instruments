/**
 * Names of game data in the current language, by id/index. The logic in
 * `src/lib/*` keeps its Russian names (tests compare against them); the UI
 * shows these. Each helper falls back to the Russian catalog.
 */
import { t } from './core';
import type { Key } from './core';
import type { PetId } from '@/lib/pets';
import type { SkinId } from '@/lib/skins';

const k = (s: string) => s as Key;

export const rockName = (i: number) => t(k(`mine.rock.${i}`));
export const blockName = (i: number) => t(k(`mine.block.${i}`));
export const pickName = (i: number) => t(k(`mine.pick.${i}`));
export const rarityName = (id: string) => t(k(`mine.rarity.${id}`));
export const enchantName = (id: string) => t(k(`mine.enchant.${id}`));
export const itemName = (id: string) => t(k(`mine.item.${id}.name`));
export const itemText = (id: string) => t(k(`mine.item.${id}.text`));
export const runeName = (id: string) => t(k(`mine.rune.${id}.name`));
export const runeText = (id: string) => t(k(`mine.rune.${id}.text`));
export const streakName = (i: number) => t(k(`mine.streak.${i}`));
export const chestName = (id: string) => t(k(`mine.chest.${id}`));
export const crewName = (id: string) => t(k(`mine.crew.${id}.name`));
export const crewText = (id: string) => t(k(`mine.crew.${id}.text`));
export const perkName = (id: string) => t(k(`mine.perk.${id}.name`));
export const perkText = (id: string) => t(k(`mine.perk.${id}.per`));
export const horizonName = (i: number) => t(k(`mine.horizon.${i}`));
export const orbName = (id: string) => t(k(`slots.orb.${id}`));
export const lineName = (i: number) => t(k(`slots.line.l${i}`));
/** Line name inside a sentence («три в ряд — центр!», «tres en raya en el centro»). */
export const lineIn = (i: number) => t(k(`slots.lineIn.l${i}`));
export const winStepName = (id: string) => t(k(`slots.step.${id}`));
export const petName = (id: PetId) => t(`pets.${id}.name`);
export const petLore = (id: PetId) => t(`pets.${id}.lore`);
export const skinText = (id: SkinId, field: 'name' | 'hint' | 'title' | 'subtitle') =>
  t(`skins.${id}.${field}`);
