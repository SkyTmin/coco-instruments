/**
 * Yard and square names in the current language (area `yardData`, generated
 * from `src/lib/yard.ts`, `hub-maps.ts`, `hub-dialog.ts`). The lib keeps its
 * Russian names for the logic and tests; `yard.test.ts` checks the Russian
 * catalog equals them.
 */
import { hasKey, t } from './core';
import type { Key } from './core';

const k = (s: string) => s as Key;

export const eventName = (id: string) => t(k(`yardData.event.${id}.name`));
export const eventLead = (id: string) => t(k(`yardData.event.${id}.lead`));

/** A square map's title («Площадь», «Кузница»…); unknown map — its own name. */
export const hubMapName = (id: string, own = '') => {
  const key = `yardData.map.${id}`;
  return hasKey(key) ? t(key) : own;
};

/** A resident's name by id; a resident without lines yet — the map's name or «Житель». */
export const npcName = (id: string, own = '') => {
  const key = `yardData.npc.${id}`;
  return hasKey(key) ? t(key) : own || t('hub.resident');
};

/** A door's label: a map door by its target map, a game door (`@prison`…) by its action. */
export const doorLabel = (d: { to: string; label?: string }) => {
  const key = d.to.startsWith('@') ? `yardData.act.${d.to.slice(1)}` : `yardData.door.${d.to}`;
  if (hasKey(key)) return t(key);
  return d.label || t('yard.open');
};
