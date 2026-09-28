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
  liftCost,
  matDef,
  MEATS,
  MOBS,
  normalizeDungeon,
} from './dungeon';
import type { DungeonState } from './dungeon';
import { FLOORS } from './dungeon-floors';
import { DEEP_PYRITE, DEEP_WALLROCK } from './dungeon-floors/types';
import { BOSS_SCRIPTS, BRAINS } from './dungeon-ai';
import { API, createSim, NO_INPUT, spawnMob, stepSim } from './dungeon-sim';
import { heroOf } from './dungeon';
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

describe('этажи подземелья: лифты', () => {
  it('починка лифта — без миллионов и из материала своего этажа', () => {
    for (const a of AREAS) {
      const c = liftCost(a.id);
      expect(c.coins, a.id).toBeLessThan(1_000_000);
      const [[mat, n]] = Object.entries(c.mats) as [string, number][];
      expect(n, a.id).toBeLessThan(400);
      expect(
        FLOORS.find((f) => f.id === a.floor)!.mats.some((m) => m.id === mat),
        a.id,
      ).toBe(true);
    }
  });
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

describe('движок для этажей: щит, смена клеток, перенос героя', () => {
  const wd = buildWorld(1);
  const lift = liftOf(wd, entryArea(1))!;
  const make = () =>
    createSim({
      world: wd,
      dungeon: DUNGEON_START,
      stats: heroOf(DUNGEON_START),
      x: lift.x + 0.5,
      y: lift.y + 1.5,
      seed: 3,
      now: () => 1e12,
    });

  it('onHit: вернул 0 — удар отбит, урона нет, звон', () => {
    const id = MOBS.rat.brain;
    const was = BRAINS.get(id)!;
    BRAINS.set(id, { ...was, onHit: () => 0 });
    try {
      const s = make();
      s.mobs = [];
      const m = spawnMob(s, 'rat', s.hero.x + 0.8, s.hero.y, { mode: 'chase' });
      const hp = m.hp;
      let clank = 0;
      for (let i = 0; i < 40; i++) {
        stepSim(s, 1 / 60, { ...NO_INPUT, attack: i % 10 === 0, aim: { x: 1, y: 0 } });
        clank += s.events.filter((e) => e.t === 'clank').length;
        m.x = s.hero.x + 0.8;
        m.y = s.hero.y;
      }
      expect(clank).toBeGreaterThan(0);
      expect(m.hp).toBe(hp);
    } finally {
      BRAINS.set(id, was);
    }
  });

  it('setTile меняет клетку только этой вылазке, moveHero переносит сразу', () => {
    const s = make();
    const x = Math.floor(s.hero.x) + 1;
    const y = Math.floor(s.hero.y);
    API.setTile(s, x, y, Tile.Wall, 7);
    expect(s.tiles[y * wd.w + x]).toBe(Tile.Wall);
    expect(s.world.mark[y * wd.w + x]).toBe(7);
    expect(wd.mark[y * wd.w + x]).not.toBe(7);
    expect(s.retiled).toContain(y * wd.w + x);
    const w0 = s.warps;
    s.hero.vx = 5;
    API.moveHero(s, lift.x + 0.5, lift.y + 3.5);
    expect(s.hero.vx).toBe(0);
    expect(s.warps).toBe(w0 + 1);
    expect(Math.hypot(s.hero.x - lift.x - 0.5, s.hero.y - lift.y - 3.5)).toBeLessThan(0.6);
  });
});

describe('этажи подземелья: заготовки спрятаны', () => {
  it('заготовки — только в конце, лестница на них закрыта', async () => {
    const { OPEN_FLOORS, READY_FLOORS, floorReady } = await import('./dungeon');
    // Открытые — подряд с первого, до первой заготовки.
    expect(OPEN_FLOORS.map((f) => f.id)).toEqual(OPEN_FLOORS.map((_, i) => i + 1));
    for (const f of OPEN_FLOORS) expect(f.draft).toBeFalsy();
    for (const f of READY_FLOORS) expect(floorReady(f.id)).toBe(true);
    const last = OPEN_FLOORS.length;
    if (last === FLOORS.length) return;
    expect(FLOORS[last].draft).toBe(true);
    expect(floorReady(last + 1)).toBe(false);
    const d: DungeonState = {
      ...DUNGEON_START,
      reached: FLOORS.length,
      run: {
        lift: entryArea(last),
        floor: last,
        area: entryArea(last),
        x: 10,
        y: 10,
        hp: 40,
        sack: EMPTY_SACK,
        started: 1,
        killed: 0,
      },
    };
    expect(descendRun(d)).toBeNull();
  });
});
