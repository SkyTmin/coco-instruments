// Каркас этажей подземелья (v2.81): любой этаж обязан собираться, быть
// проходимым и держать договор — лифт на входе, арена босса за воротами,
// лестница вниз за печатью, шахта с блоками ровно двух руд этажа. Эти
// проверки гоняют ВСЕ этажи: новый этаж, нарушивший договор, уронит их.

import { describe, expect, it } from 'vitest';
import {
  AREAS,
  applyDelta,
  BOSSES,
  deepBlocks,
  deepField,
  DEEP_MINES,
  descendRun,
  DUNGEON_START,
  EMPTY_SACK,
  entryArea,
  floorBeaten,
  matDef,
  MEATS,
  MOBS,
  normalizeDungeon,
} from './dungeon';
import type { DungeonState } from './dungeon';
import { FLOORS } from './dungeon-floors';
import { DEEP_PYRITE, DEEP_WALLROCK } from './dungeon-floors/types';
import { BOSS_SCRIPTS, BRAINS } from './dungeon-ai';
import './dungeon-sim';
import { arenaCells, buildWorld, liftOf, reachable, Tile, walkableTile } from './dungeon-world';
import type { World } from './dungeon-world';
import { x72HasMob } from './dungeon-mobart';
import { DEPTH, MINE_CELLS, ROCKS } from './prison';

/** Достижимо, считая печати стеной: так ходит тот, кто босса не победил. */
function reachSealed(wd: World, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(wd.w * wd.h);
  const q = [sy * wd.w + sx];
  seen[q[0]] = 1;
  const pass = (t: number) =>
    walkableTile(t) || t === Tile.Grate || t === Tile.Gate || t === Tile.Crack;
  while (q.length) {
    const i = q.shift()!;
    const x = i % wd.w;
    const y = Math.floor(i / wd.w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= wd.w || ny >= wd.h) continue;
      const j = ny * wd.w + nx;
      if (seen[j] || !pass(wd.tiles[j])) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}

describe('этажи подземелья: договор', () => {
  it('этажи идут по порядку с первого, id районов не повторяются', () => {
    expect(FLOORS.map((f) => f.id)).toEqual(FLOORS.map((_, i) => i + 1));
    const ids = AREAS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const mobs = FLOORS.flatMap((f) => f.mobs.map((m) => m.id));
    expect(new Set(mobs).size).toBe(mobs.length);
    const mines = FLOORS.flatMap((f) => f.mines.map((m) => m.id));
    expect(new Set(mines).size).toBe(mines.length);
  });

  for (const f of FLOORS) {
    describe(`этаж ${f.id} «${f.name}»`, () => {
      const wd = buildWorld(f.id);

      it('карта: ряды по 64, лифт на входе, всё главное достижимо', () => {
        for (const a of f.areas)
          for (const [i, r] of a.rows.entries()) expect(r.length, `${a.id} ряд ${i}`).toBe(wd.w);
        const lift = liftOf(wd, entryArea(f.id));
        expect(lift, 'лифт входа').not.toBeNull();
        const seen = reachable(wd, lift!.x, lift!.y);
        const boss = wd.objs.find((o) => o.kind === 'boss');
        expect(boss, 'логово босса (K)').toBeTruthy();
        expect(seen[boss!.y * wd.w + boss!.x], 'до босса можно дойти').toBe(1);
        for (const o of wd.objs.filter((k) => k.kind === 'mine'))
          expect(seen[o.y * wd.w + o.x] || seen[(o.y + 1) * wd.w + o.x], `шахта ${o.ref}`).toBe(1);
      });

      it('арена босса замкнута воротами, лифт и лестница — снаружи', () => {
        const boss = wd.objs.find((o) => o.kind === 'boss')!;
        const arena = arenaCells(wd, boss);
        expect(arena.size).toBeGreaterThan(40);
        expect(arena.size).toBeLessThan(1500);
        const gates = wd.objs.filter((o) => o.kind === 'gate');
        expect(gates.length).toBeGreaterThan(0);
        const lift = liftOf(wd, entryArea(f.id))!;
        expect(arena.has(lift.y * wd.w + lift.x)).toBe(false);
        for (const s of wd.objs.filter((o) => o.kind === 'stairs'))
          expect(arena.has(s.y * wd.w + s.x)).toBe(false);
      });

      it('лестница вниз есть и закрыта печатью, пока босс жив', () => {
        const stairs = wd.objs.filter((o) => o.kind === 'stairs');
        if (f.id === FLOORS.length && !stairs.length) return;
        expect(stairs.length, 'лестница (>)').toBeGreaterThan(0);
        const lift = liftOf(wd, entryArea(f.id))!;
        const sealed = reachSealed(wd, lift.x, lift.y);
        const open = reachable(wd, lift.x, lift.y);
        for (const s of stairs) {
          expect(sealed[s.y * wd.w + s.x], 'до лестницы не дойти мимо печати').toBe(0);
          expect(open[s.y * wd.w + s.x], 'после победы — дойти можно').toBe(1);
        }
      });

      it('монстры: ИИ зарегистрирован, рисунок есть, материалы описаны', () => {
        for (const m of f.mobs) {
          expect(BRAINS.has(m.brain), `ИИ «${m.brain}» у ${m.id}`).toBe(true);
          if (m.art.kind === 'x72') expect(x72HasMob(m.art.name), `атлас ${m.art.name}`).toBe(true);
          for (const [id] of m.mats) expect(matDef(id).name, `материал ${id}`).not.toBe(id);
          if (m.meat) expect(MEATS[m.meat[0]], `мясо ${m.meat[0]}`).toBeTruthy();
        }
        expect(BOSS_SCRIPTS.has(f.boss.script), `сценарий ${f.boss.script}`).toBe(true);
        expect(BOSSES[f.boss.id].floor).toBe(f.id);
        for (const p of f.boss.parts) expect(MOBS[p]?.boss, `часть босса ${p}`).toBe(true);
      });

      it('шахты этажа: руда и блоки — только двух руд этажа', () => {
        expect(f.mines.length).toBeGreaterThan(0);
        for (const m of f.mines) {
          const def = DEEP_MINES[m.id];
          expect(def.ores.every((r) => ROCKS[r])).toBe(true);
          const ok = new Set([...def.ores, DEEP_WALLROCK, DEEP_PYRITE]);
          let blocks = 0;
          for (let w = 0; w < 60; w++) {
            for (const r of deepField(m.id, w, MINE_CELLS, DEPTH))
              expect(ok.has(r), `порода ${r}`).toBe(true);
            for (const b of deepBlocks(m.id, w, MINE_CELLS, DEPTH)) {
              expect(def.ores).toContain(b.rock);
              expect(b.depth).toBeGreaterThanOrEqual(0);
              expect(b.depth).toBeLessThan(DEPTH);
              blocks += 1;
            }
          }
          // Блоки редкие, но попадаются: в среднем около `blocks` на окно.
          expect(blocks / 60).toBeGreaterThan(def.blocks * 0.5);
          expect(blocks / 60).toBeLessThan(def.blocks * 1.6 + 0.5);
        }
      });
    });
  }
});

describe('этажи подземелья: спуск и сохранение', () => {
  const withRun = (d: DungeonState, floor: number): DungeonState => ({
    ...d,
    run: {
      lift: entryArea(floor),
      floor,
      area: entryArea(floor),
      x: 10,
      y: 10,
      hp: 40,
      sack: { ...EMPTY_SACK, coins: 5 },
      started: 1,
      killed: 0,
    },
  });

  it('вниз — только после победы над боссом этажа', () => {
    const d = withRun(DUNGEON_START, 1);
    expect(floorBeaten(d, 1)).toBe(false);
    expect(descendRun(d)).toBeNull();
    const won = applyDelta(d, {
      kills: {},
      stats: {},
      xp: 0,
      lamps: [],
      opened: [],
      secrets: [],
      bosses: [{ id: FLOORS[0].boss.id, at: 5 }],
    });
    expect(won.reached).toBe(2);
    expect(won.lifts).toContain(entryArea(2));
    const down = descendRun(won)!;
    expect(down.run!.floor).toBe(2);
    expect(down.run!.area).toBe(entryArea(2));
    expect(down.run!.x).toBeLessThan(0);
    // Рюкзак и здоровье — с собой.
    expect(down.run!.sack.coins).toBe(5);
    expect(down.run!.hp).toBe(40);
  });

  it('старое сохранение: убил короля — второй этаж открыт', () => {
    const old = {
      ...DUNGEON_START,
      mapVers: undefined,
      reached: undefined,
      mapVer: 2,
      bosses: { king: { at: 1, kills: 3 } },
    };
    const d = normalizeDungeon(old);
    expect(d.reached).toBe(2);
    expect(d.lifts).toContain(entryArea(2));
    const fresh = normalizeDungeon({ ...DUNGEON_START, mapVers: undefined, mapVer: 2 });
    expect(fresh.reached).toBe(1);
  });

  it('вылазка на другом этаже переживает сохранение', () => {
    const d = normalizeDungeon(withRun({ ...DUNGEON_START, reached: 3 }, 3));
    expect(d.run!.floor).toBe(3);
    expect(d.run!.area).toBe(entryArea(3));
    expect(d.run!.x).toBe(10);
  });
});
