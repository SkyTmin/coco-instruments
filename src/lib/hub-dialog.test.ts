import { describe, expect, it } from 'vitest';
import { DUNGEON_START } from './dungeon';
import { hubFacts, RESIDENTS, residentOf } from './hub-dialog';
import type { HubFacts } from './hub-dialog';
import { HUB_MAPS } from './hub-maps';
import { LAST_RANK, PRISON_START } from './prison';

const NOW = 1_800_000_000_000;

function variants(): HubFacts[] {
  const base = hubFacts(PRISON_START, DUNGEON_START, 0, NOW);
  return [
    base,
    hubFacts({ ...PRISON_START, rank: 8, keys: 3, tokens: 5_000 }, DUNGEON_START, 1e6, NOW),
    hubFacts({ ...PRISON_START, rank: LAST_RANK, prestige: 3 }, DUNGEON_START, 1e7, NOW),
    {
      ...base,
      forgeReady: true,
      booksReady: true,
      eggReady: true,
      hotLot: true,
      keys: 5,
      miles: 2,
      perksFree: 1,
      dungeonOpen: true,
      dungeonRun: true,
      zoneOpen: true,
      zoneMs: 600_000,
    },
  ];
}

describe('жители площади', () => {
  it('у каждого 1–5 коротких реплик и рабочие кнопки в любом состоянии', () => {
    for (const r of Object.values(RESIDENTS))
      for (const f of variants()) {
        const lines = r.lines(f);
        expect(lines.length, r.id).toBeGreaterThan(0);
        expect(lines.length, r.id).toBeLessThanOrEqual(5);
        for (const l of lines) {
          expect(l.trim().length, r.id).toBeGreaterThan(0);
          // Реплика — строка в окне, а не абзац.
          expect(l.length, `${r.id}: ${l}`).toBeLessThanOrEqual(90);
          expect(l, r.id).not.toMatch(/undefined|NaN|null/);
        }
        for (const o of r.options(f)) {
          expect(o.label.length).toBeGreaterThan(0);
          if (o.action.kind === 'route')
            expect(o.action.path).toMatch(/^\/(prison|dungeon|slots|scatter|games)$/);
          if (o.action.kind === 'camp') expect(o.action.tabs.length).toBeGreaterThan(0);
        }
        expect(typeof r.badge(f)).toBe('boolean');
      }
  });

  it('«!» — когда у жителя есть дело: кузнец при готовой кирке, каптёрщик при ключах', () => {
    const [base, , , busy] = variants();
    expect(RESIDENTS.smith.badge(base)).toBe(false);
    expect(RESIDENTS.smith.badge(busy)).toBe(true);
    expect(RESIDENTS.smith.lines(busy)[0]).toBe('Руды хватает. Давай молот — выкую!');
    expect(RESIDENTS.clerk.badge(base)).toBe(false);
    expect(RESIDENTS.clerk.badge(busy)).toBe(true);
    expect(RESIDENTS.keeper.badge(busy)).toBe(true);
    expect(RESIDENTS.chief.badge(busy)).toBe(true);
    expect(RESIDENTS.guard.badge(busy)).toBe(true);
  });

  it('лифтёр и охранник не пускают, пока рано, и объясняют почему', () => {
    const [base] = variants();
    expect(RESIDENTS.liftman.options(base)).toEqual([]);
    expect(RESIDENTS.liftman.lines(base)[0]).toMatch(/с ранга F/);
    expect(RESIDENTS.guard.options(base)).toEqual([]);
    expect(RESIDENTS.guard.lines(base)[0]).toMatch(/престижа/);
  });

  it('бригадир говорит, чего не хватает до ранга, а на дне — про престиж', () => {
    const [base, , last] = variants();
    expect(RESIDENTS.foreman.lines(base).join(' ')).toMatch(/монет/);
    expect(RESIDENTS.foreman.lines(last)[0]).toMatch(/престиж/);
  });

  it('у каждого жителя на картах есть реплики, а незнакомый не ломает площадь', () => {
    for (const m of Object.values(HUB_MAPS))
      for (const n of m.npcs) expect(RESIDENTS[n.id], `${m.id}: ${n.id}`).toBeTruthy();
    const x = residentOf('stranger', 'Прохожий');
    expect(x.name).toBe('Прохожий');
    expect(x.options(variants()[0])).toEqual([]);
  });
});
