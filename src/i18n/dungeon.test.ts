/**
 * Dungeon data areas (agent T3, wave 2): `dfloors`, `dmobs`, `dmats`, `dgear`
 * and `dlines` are generated from the lib and must keep matching it — rename a
 * mob in `src/lib/dungeon-floors/` and this test fails until `ru/dmobs.ts` and
 * the six translations follow. Same for the inventory's places and sections.
 */
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { AFFIXES, BEAST_STEPS, DEEP_ROCKS, SETS, SLOT_NAMES } from '@/lib/dungeon';
import { FLOORS } from '@/lib/dungeon-floors';
import { SECTIONS, WHERE_NAME } from '@/lib/inventory';
import { setLang } from './core';
import { bossName, dl, floorName, matName, mobName, setItem } from './data-dungeon';
import { ru } from './ru';

describe('dungeon catalogs equal the lib', () => {
  it('floors: names, leads, areas, bosses, mines', () => {
    const want: Record<string, unknown> = {};
    for (const f of FLOORS) {
      want[`f${f.id}`] = {
        name: f.name,
        lead: f.lead,
        area: Object.fromEntries(f.areas.map((a) => [a.id, { name: a.name, lead: a.lead }])),
        boss: { name: f.boss.name, lead: f.boss.lead },
        mine: Object.fromEntries(f.mines.map((m) => [m.id, m.name])),
      };
    }
    expect(ru.dfloors).toEqual(want);
  });

  it('mobs and materials by id', () => {
    const mobs: Record<string, unknown> = {};
    const mats: Record<string, unknown> = {};
    for (const f of FLOORS) {
      for (const m of f.mobs) mobs[m.id] = { name: m.name, many: m.many };
      for (const m of f.meats) mats[m.id] = { name: m.name };
      for (const m of f.mats) mats[m.id] = { name: m.name, lead: m.lead };
    }
    expect(ru.dmobs).toEqual(mobs);
    expect(ru.dmats).toEqual(mats);
  });

  it('gear: slots, sets, affixes, beast steps, deep rocks', () => {
    expect(ru.dgear).toEqual({
      slot: SLOT_NAMES,
      set: Object.fromEntries(
        SETS.map((s) => [String(s.tier), { name: s.name, bonus: s.bonus, item: s.items }]),
      ),
      affix: AFFIXES,
      beast: Object.fromEntries(BEAST_STEPS.map((b, i) => [String(i), b.what])),
      rock: Object.fromEntries(DEEP_ROCKS.map((r) => [r.id, r.name])),
    });
  });

  it('inventory places and sections', () => {
    expect(ru.inv.where).toEqual(WHERE_NAME);
    expect(ru.inv.section).toEqual(Object.fromEntries(SECTIONS.map((s) => [s.id, s.name])));
  });
});

// ---------------------------------------------------------------------------
// dlines: every Cyrillic string literal of the floor engines is either a data
// value above or a line of `dlines`, and `dlines` has nothing extra.

const LINE_FILES = [
  'src/lib/dungeon-sim.ts',
  'src/lib/dungeon-brains.ts',
  'src/lib/dungeon.ts',
  ...Array.from({ length: 15 }, (_, i) => [
    `src/lib/dungeon-floors/f${i + 1}.ts`,
    `src/lib/dungeon-floors/f${i + 1}-brains.ts`,
  ]).flat(),
  'src/lib/dungeon-floors/f15-boss.ts',
  'src/lib/dungeon-floors/f15-boss-brains.ts',
];
const CYR = /[\u0400-\u04ff]/;

/** String literals outside comments; templates keep `${…}`. */
function literals(src: string): { text: string; line: number; tpl: boolean }[] {
  const out: { text: string; line: number; tpl: boolean }[] = [];
  let line = 1;
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      line += (src.slice(i, end).match(/\n/g) ?? []).length;
      i = end + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      let buf = '';
      const start = line;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') {
          buf += src.slice(j, j + 2);
          j += 2;
        } else if (c === '`' && src[j] === '$' && src[j + 1] === '{') {
          let depth = 1;
          let k = j + 2;
          for (; k < src.length && depth; k++) {
            if (src[k] === '{') depth++;
            else if (src[k] === '}') depth--;
          }
          buf += '${' + src.slice(j + 2, k - 1) + '}';
          j = k;
        } else {
          if (src[j] === '\n') {
            line++;
            if (c !== '`') break;
          }
          buf += src[j++];
        }
      }
      out.push({ text: buf, line: start, tpl: c === '`' });
      i = j + 1;
    } else i++;
  }
  return out;
}

/** `ВОЛНА ${hall.wave}` and `ВОЛНА {a}` both become `ВОЛНА {}`. */
const shape = (s: string) => s.replace(/\$\{[^}]*\}|\{\w+\}/g, '{}');

function strings(o: unknown, acc: Set<string>): Set<string> {
  if (typeof o === 'string') acc.add(o);
  else if (o && typeof o === 'object') for (const v of Object.values(o)) strings(v, acc);
  return acc;
}

describe('dungeon lines', () => {
  it('dlines equal the Cyrillic literals of the floor engines', () => {
    const data = strings([ru.dfloors, ru.dmobs, ru.dmats, ru.dgear], new Set());
    const found = new Set<string>();
    for (const f of LINE_FILES) {
      if (!existsSync(f)) continue;
      const src = readFileSync(f, 'utf8');
      const lines = src.split('\n');
      for (const l of literals(src)) {
        if (!CYR.test(l.text) || lines[l.line - 1].includes('i18n-ignore')) continue;
        if (!data.has(l.text)) found.add(shape(l.text));
      }
    }
    const have = new Set([...strings(ru.dlines, new Set())].map(shape));
    expect([...found].filter((s) => !have.has(s))).toEqual([]);
    expect([...have].filter((s) => !found.has(s))).toEqual([]);
  });

  afterAll(() => setLang('ru', false));

  it('dl() finds a line by its Russian text, templates too', async () => {
    expect(dl('ЛАВА ОТСТУПИЛА')).toBe('ЛАВА ОТСТУПИЛА');
    expect(dl('нет такой строки')).toBe('нет такой строки');
    await setLang('en', false);
    expect(dl('ЛАВА ОТСТУПИЛА')).toBe('THE LAVA RECEDED');
    expect(dl('ВОЛНА 2')).toBe('WAVE 2');
    expect(dl('Разбить (1/3)')).toBe('Break (1/3)');
    expect(floorName(1)).toBe('Rat Burrows');
    expect(bossName('king')).toBe('Rat King');
    expect(mobName('rat')).toBe('Gray Rat');
    expect(matName('crown')).toBe("Rat King's Crown");
    expect(setItem(2, 'helm')).toBe('Lamp Helmet');
  });
});
