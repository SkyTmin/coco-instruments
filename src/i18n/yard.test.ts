import { describe, expect, it } from 'vitest';
import { ru } from './ru';
import { EVENTS } from '@/lib/yard';
import { HUB_MAPS } from '@/lib/hub-maps';
import { RESIDENTS } from '@/lib/hub-dialog';

// Change a name in src/lib — change ru/yardData.ts and the six translations with it.
describe('ru.yardData equals src/lib', () => {
  it('events, square maps, residents, door labels', () => {
    const door: Record<string, string> = {};
    const act: Record<string, string> = {};
    for (const m of Object.values(HUB_MAPS))
      for (const d of m.doors) {
        const to = d.to.startsWith('@') ? act : door;
        const id = d.to.replace(/^@/, '');
        // One label per target: the catalog keys doors by where they lead.
        expect(to[id] ?? d.label, `${m.id} → ${d.to}`).toBe(d.label);
        to[id] = d.label ?? '';
      }
    expect(ru.yardData).toEqual({
      event: Object.fromEntries(EVENTS.map((e) => [e.id, { name: e.name, lead: e.lead }])),
      map: Object.fromEntries(Object.values(HUB_MAPS).map((m) => [m.id, m.name])),
      npc: Object.fromEntries(Object.values(RESIDENTS).map((r) => [r.id, r.name])),
      door,
      act,
    });
    for (const m of Object.values(HUB_MAPS))
      for (const n of m.npcs) expect(n.name, `${m.id}: ${n.id}`).toBe(RESIDENTS[n.id]?.name);
  });
});
