/**
 * Dungeon data in the current language (agent T3, wave 2). The lib keeps its
 * Russian (`src/lib/dungeon*.ts`, `src/lib/dungeon-floors/`); the areas
 * `dfloors`, `dmobs`, `dmats`, `dgear`, `dlines` are generated from it and
 * `src/i18n/dungeon.test.ts` checks they still match.
 *
 * Names go by id. Lines of the floor engines (banners `e.text/e.sub`, action
 * labels, condition labels) have no ids — `dl(text)` finds the line by its
 * Russian text (templates `{a}` too) and returns the translation.
 */
import { BOSSES, areaOf, itemRock, matDef } from '@/lib/dungeon';
import type { Slot } from '@/lib/dungeon';
import { hasKey, t } from './core';
import type { Key } from './core';
import { blockName, rockName } from './data';
import { ru } from './ru';

const k = (s: string) => s as Key;
/** Key of the catalog, or the Russian fallback when the id is unknown. */
const tk = (key: string, fallback: string) => (hasKey(key) ? t(key) : fallback);

export const floorName = (n: number) => tk(`dfloors.f${n}.name`, '');
export const floorLead = (n: number) => tk(`dfloors.f${n}.lead`, '');
export const areaName = (id: string) => {
  const a = areaOf(id);
  return tk(`dfloors.f${a.floor}.area.${id}.name`, a.name);
};
export const areaLead = (id: string) => {
  const a = areaOf(id);
  return tk(`dfloors.f${a.floor}.area.${id}.lead`, a.lead);
};
/** Boss by id (`BossDef.id`). */
export const bossName = (id: string) => {
  const b = BOSSES[id];
  return b ? tk(`dfloors.f${b.floor}.boss.name`, b.name) : id;
};
export const bossLead = (id: string) => {
  const b = BOSSES[id];
  return b ? tk(`dfloors.f${b.floor}.boss.lead`, b.lead) : '';
};
export const mineName = (floor: number, id: string) => tk(`dfloors.f${floor}.mine.${id}`, id);
export const mobName = (id: string) => tk(`dmobs.${id}.name`, id);
/** Plural of the mob for counters («убить серых крыс» → «kill grey rats»). */
export const mobMany = (id: string) => tk(`dmobs.${id}.many`, id);

/** Backpack thing: floor meat/material, mine ore `ore:N` or block `block:N`. */
export function matName(id: string): string {
  const r = itemRock(id);
  if (r) return r.kind === 'ore' ? rockName(r.rock) : blockName(r.rock);
  return tk(`dmats.${id}.name`, matDef(id).name);
}
export function matLead(id: string): string {
  if (itemRock(id)) return dl(matDef(id).lead);
  return tk(`dmats.${id}.lead`, matDef(id).lead);
}

export const slotName = (s: Slot) => t(k(`dgear.slot.${s}`));
/** Gear set by tier (1…8). */
export const setName = (tier: number) => tk(`dgear.set.${tier}.name`, '');
export const setBonus = (tier: number) => tk(`dgear.set.${tier}.bonus`, '');
export const setItem = (tier: number, s: Slot) => tk(`dgear.set.${tier}.item.${s}`, '');
export const affixName = (a: string) => tk(`dgear.affix.${a}`, a);
export const beastText = (i: number) => tk(`dgear.beast.${i}`, '');
export const deepRockName = (id: string) => tk(`dgear.rock.${id}`, id);

// ---------------------------------------------------------------------------
// Lines by their Russian text

type Leaf = string | Record<string, string>;
let exact: Map<string, string> | null = null;
let patterns: { re: RegExp; key: string; names: string[] }[] = [];

function index(): Map<string, string> {
  if (exact) return exact;
  exact = new Map();
  const walk = (o: Record<string, Leaf | object>, pre: string) => {
    for (const [name, v] of Object.entries(o)) {
      const key = `${pre}${name}`;
      if (typeof v !== 'string') {
        walk(v as Record<string, Leaf | object>, `${key}.`);
        continue;
      }
      if (exact!.has(v)) continue;
      exact!.set(v, key);
      if (v.includes('{')) {
        const names: string[] = [];
        const src = v
          .split(/(\{\w+\})/g)
          .map((p) => {
            const m = /^\{(\w+)\}$/.exec(p);
            if (!m) return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            names.push(m[1]);
            return '(.+?)';
          })
          .join('');
        patterns.push({ re: new RegExp(`^${src}$`, 's'), key, names });
      }
    }
  };
  // Names first: a line that IS a name (boss in a banner) reads as the name.
  walk(ru.dfloors, 'dfloors.');
  walk(ru.dmobs, 'dmobs.');
  walk(ru.dmats, 'dmats.');
  walk(ru.dgear, 'dgear.');
  walk(ru.dlines, 'dlines.');
  // Longer templates first: «ЭХО · {a}» must not lose to a shorter one.
  patterns = patterns.sort((a, b) => b.re.source.length - a.re.source.length);
  return exact;
}

/**
 * A dungeon line in the current language, found by its Russian text. Unknown
 * text comes back as is (a new line not yet in the catalog stays readable).
 */
export function dl(text: string): string;
export function dl(text: string | undefined): string | undefined;
export function dl(text: string | undefined): string | undefined {
  if (!text) return text;
  const key = index().get(text);
  if (key) return t(k(key));
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const params: Record<string, string> = {};
    p.names.forEach((n, i) => (params[n] = dl(m[i + 1])));
    return t(k(p.key), params);
  }
  return text;
}
