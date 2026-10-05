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
import { API, createSim, creativeWarp, NO_INPUT, spawnMob, stepSim } from './dungeon-sim';
import type { SimEvent } from './dungeon-sim';
import { heroOf } from './dungeon';
import { arenaCells, buildWorld, liftOf, reachable, Tile, walkableTile } from './dungeon-world';
import type { World } from './dungeon-world';
import { x72HasMob } from './dungeon-mobart';
import { frameLRU } from './dungeon-paint';
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

describe('этаж 15: договор «Мира» и «Сердца»', () => {
  it('последний район — «Сердце», стык ровно в столбцах F15_JOIN', async () => {
    const { F15_HEART_AREA, F15_JOIN, F15_BOSS } = await import('./dungeon-floors/f15-boss');
    const f = FLOORS.find((x) => x.id === 15)!;
    expect(f.areas[f.areas.length - 1]).toBe(F15_HEART_AREA);
    expect(f.boss).toBe(F15_BOSS);
    expect(F15_BOSS.id).toBe('f15boss');
    expect(F15_BOSS.area).toBe(F15_HEART_AREA.id);
    const open = (r: string) => [...r].map((c, i) => (c === '#' ? -1 : i)).filter((i) => i >= 0);
    const want = Array.from({ length: F15_JOIN.x1 - F15_JOIN.x0 + 1 }, (_, i) => F15_JOIN.x0 + i);
    const heart = F15_HEART_AREA.rows;
    expect(open(heart[heart.length - 1]), 'низ «Сердца»').toEqual(want);
    const world = f.areas[f.areas.length - 2].rows;
    expect(open(world[0]), 'верх «Мира»').toEqual(want);
    expect(f.mats.some((m) => m.id === 'f15mat')).toBe(true);
  });
});

describe('креатив: ТП к боссу и к лифту', () => {
  for (const f of FLOORS)
    it(`этаж ${f.id}: к воротам снаружи, бой стартует сам; лифт сбрасывает бой`, () => {
      const wd = buildWorld(f.id);
      const lift = liftOf(wd, entryArea(f.id))!;
      const s = createSim({
        world: wd,
        dungeon: DUNGEON_START,
        stats: heroOf(DUNGEON_START),
        x: lift.x + 0.5,
        y: lift.y + 0.5,
        seed: 3,
        now: () => 1e12,
        god: true,
      });
      const b = s.boss!;
      const w = wd.w;
      const cell = () => Math.floor(s.hero.y) * w + Math.floor(s.hero.x);
      const near = (g: number) =>
        Math.hypot((g % w) + 0.5 - s.hero.x, Math.floor(g / w) + 0.5 - s.hero.y);
      // Отдыхающий босс просыпается.
      b.state = 'rest';
      b.readyAt = 2e12;
      expect(creativeWarp(s, 'boss')).toBe(true);
      expect(b.state).toBe('idle');
      expect(b.cells.has(cell()), 'снаружи арены').toBe(false);
      expect(walkableTile(s.tiles[cell()])).toBe(true);
      const gate = [...b.gates].sort((p, q) => near(p) - near(q))[0];
      expect(near(gate)).toBeLessThan(1.6);
      expect(s.tiles[gate], 'ворота открыты').toBe(Tile.Floor);
      // Шаг за ворота — бой начинается сам.
      const inside = [1, -1, w, -w].map((d) => gate + d).find((i) => b.cells.has(i))!;
      API.moveHero(s, (inside % w) + 0.5, Math.floor(inside / w) + 0.5);
      stepSim(s, 1 / 60, { ...NO_INPUT });
      expect(b.state).toBe('fight');
      // Повторный ТП в бою — рядом с боссом, на арене.
      expect(creativeWarp(s, 'boss')).toBe(true);
      expect(b.cells.has(cell()), 'на арене').toBe(true);
      expect(b.state).toBe('fight');
      // К лифту: бой сброшен, ворота открыты, герой на лифте.
      expect(creativeWarp(s, 'lift')).toBe(true);
      expect(b.state).toBe('idle');
      for (const g of b.gates) expect(s.tiles[g]).toBe(Tile.Floor);
      expect(
        wd.objs.some(
          (o) => o.kind === 'lift' && o.x === Math.floor(s.hero.x) && o.y === Math.floor(s.hero.y),
        ),
      ).toBe(true);
      expect(s.mobs.some((m) => MOBS[m.kind]?.boss)).toBe(false);
    });
});

describe('движок 3', () => {
  const wd = buildWorld(1);
  const lift = liftOf(wd, entryArea(1))!;
  const make = (god = false) => {
    const s = createSim({
      world: wd,
      dungeon: DUNGEON_START,
      stats: heroOf(DUNGEON_START),
      x: lift.x + 0.5,
      y: lift.y + 1.5,
      seed: 5,
      now: () => 1e12,
      god,
    });
    s.mobs = [];
    s.hero.inv = 0;
    // Площадка 9×5 вокруг героя — чистый пол: проверкам не мешают стены карты.
    const hx = Math.floor(s.hero.x);
    const hy = Math.floor(s.hero.y);
    for (let y = hy - 2; y <= hy + 2; y++)
      for (let x = hx - 4; x <= hx + 4; x++) s.tiles[y * wd.w + x] = Tile.Floor;
    return { s, hx, hy };
  };
  const idle = { ...NO_INPUT };

  it('E1: клетка с опасностью — только своей вылазке; стена выталкивает', () => {
    const { s, hx, hy } = make();
    API.setTile(s, hx + 1, hy, Tile.Hazard, 0, { dps: 0.5, slow: 0.5 });
    const i = hy * wd.w + hx + 1;
    expect(s.world.haz[i]).toBeGreaterThan(0);
    expect(wd.haz[i]).toBe(0);
    expect(s.world.hazards[s.world.haz[i] - 1].dps).toBe(0.5);
    // Та же опасность второй раз — та же запись таблицы.
    const n = s.world.hazards.length;
    API.setTile(s, hx + 2, hy, Tile.Hazard, 0, { dps: 0.5, slow: 0.5 });
    expect(s.world.hazards.length).toBe(n);
    // Снять опасность.
    API.setTile(s, hx + 1, hy, Tile.Floor, 0, null);
    expect(s.world.haz[i]).toBe(0);
    // Стена под героем и под мобом — оба выходят на ближнюю проходимую.
    const m = spawnMob(s, 'rat', hx - 1.5, hy + 0.5, { mode: 'chase' });
    API.setTile(s, hx, hy, Tile.Wall);
    API.setTile(s, hx - 2, hy, Tile.Wall);
    expect(Math.floor(s.hero.x) !== hx || Math.floor(s.hero.y) !== hy).toBe(true);
    expect(Math.floor(m.x) !== hx - 2 || Math.floor(m.y) !== hy).toBe(true);
  });

  it('E2: свет на ходу — поставить, сдвинуть, погасить; мир общий не трогается', () => {
    const { s } = make();
    const n0 = wd.lights.length;
    API.light(s, 'fire', { x: 3, y: 4, r: 5, tint: 'red' });
    expect(s.world.lights.length).toBe(n0 + 1);
    API.light(s, 'fire', { x: 6, y: 4, r: 5, tint: 'red' });
    expect(s.world.lights.length).toBe(n0 + 1);
    expect(s.world.lights.at(-1)!.x).toBe(6);
    API.light(s, 'fire', null);
    expect(s.world.lights.length).toBe(n0);
    expect(wd.lights.length).toBe(n0);
  });

  it('E3: урон окружения — мимо брони, неуязвимость спасает, бессмертие держит', () => {
    const { s } = make();
    const hp = s.hero.hp;
    API.hurtEnv(s, 0.1);
    expect(hp - s.hero.hp).toBeCloseTo(s.stats.maxHp * 0.1, 3);
    s.hero.inv = 1;
    const hp1 = s.hero.hp;
    API.hurtEnv(s, 0.5);
    expect(s.hero.hp).toBe(hp1);
    s.hero.inv = 0;
    API.hurtEnv(s, 5);
    expect(s.hero.mode).toBe('dying');
    const g = make(true).s;
    API.hurtEnv(g, 5);
    expect(g.hero.hp).toBe(1);
    expect(g.hero.mode).not.toBe('dying');
  });

  it('E4: сорвался в пропасть — убийство в зачёт, добыча на краю', () => {
    const { s, hx, hy } = make();
    s.tiles[hy * wd.w + hx + 3] = Tile.Deep;
    const m = spawnMob(s, 'rat', hx + 3.5, hy + 0.5, { mode: 'chase' });
    const k0 = s.killed;
    API.fall(s, m);
    expect(s.killed).toBe(k0 + 1);
    expect(m.fell).toBe(true);
    expect(s.delta.kills.rat).toBe(1);
    for (const d of s.drops)
      expect(s.tiles[Math.floor(d.y) * wd.w + Math.floor(d.x)]).not.toBe(Tile.Deep);
    expect(s.events.some((e) => e.t === 'fall')).toBe(true);
  });

  it('E5: дуга кольца, стены режут удар, удар по своим', () => {
    const { s, hx, hy } = make();
    const x = s.hero.x;
    const y = s.hero.y;
    const ring = (ang: number) =>
      API.strike(s, { shape: 'ring', x: x - 2, y, r: 2, w: 0.4, ang, arc: 1, warn: 0, dmg: 30 });
    // Сектор смотрит от героя — мимо.
    ring(Math.PI);
    const hp0 = s.hero.hp;
    stepSim(s, 1 / 60, idle);
    expect(s.hero.hp).toBe(hp0);
    // Сектор на героя — попал.
    s.hero.inv = 0;
    ring(0);
    // Удар сработал — стоп-кадр; следующий сработает после него.
    for (let i = 0; i < 6; i++) stepSim(s, 1 / 60, idle);
    expect(s.hero.hp).toBeLessThan(hp0);
    // Стена между ударом и героем при `los` — мимо.
    const s2 = make().s;
    s2.tiles[hy * wd.w + hx + 2] = Tile.Wall;
    API.strike(s2, {
      shape: 'circle',
      x: hx + 3.5,
      y: hy + 0.5,
      r: 4,
      warn: 0,
      dmg: 30,
      los: true,
    });
    const h2 = s2.hero.hp;
    stepSim(s2, 1 / 60, idle);
    expect(s2.hero.hp).toBe(h2);
    // Поезд давит своих.
    const s3 = make().s;
    const rat = spawnMob(s3, 'rat', hx + 3.5, hy + 0.5, { mode: 'chase' });
    API.strike(s3, {
      shape: 'line',
      x: hx - 3.5,
      y: hy + 0.5,
      r: 8,
      w: 0.6,
      ang: 0,
      warn: 0,
      dmg: 0,
      mobDmg: Infinity,
    });
    stepSim(s3, 1 / 60, idle);
    expect(rat.mode).toBe('dying');
  });

  it('E6: героя тянут — едет к точке, ввод заперт, конец у точки', () => {
    const { s } = make();
    const x0 = s.hero.x;
    API.pullHero(s, x0 + 3, s.hero.y, { speed: 10, inv: true });
    // Джойстик тянет назад — пока героя тянут, он не слушается.
    let i = 0;
    for (; i < 60 && s.hero.pull; i++) stepSim(s, 1 / 60, { ...NO_INPUT, mx: -1 });
    expect(s.hero.pull).toBeFalsy();
    expect(i).toBeLessThan(40);
    expect(s.hero.x).toBeGreaterThan(x0 + 2.5);
  });

  it('E7: мир стоит — мобы замерли, герой идёт; время возвращается само', () => {
    const { s, hx, hy } = make();
    const m = spawnMob(s, 'rat', hx + 3.5, hy + 0.5, { mode: 'chase' });
    API.timeScale(s, 0, 1, 0.5);
    const mx = m.x;
    const t0 = s.time;
    const x0 = s.hero.x;
    for (let i = 0; i < 20; i++) stepSim(s, 1 / 60, { ...NO_INPUT, mx: -1 });
    expect(m.x).toBe(mx);
    expect(s.time).toBe(t0);
    expect(s.hero.x).toBeLessThan(x0);
    for (let i = 0; i < 30; i++) stepSim(s, 1 / 60, idle);
    expect(s.worldScale).toBe(1);
    expect(s.time).toBeGreaterThan(t0);
  });

  it('E8: своё действие этажа — кнопка с подписью, нажатие зовёт этаж', async () => {
    const { FLOOR_SCRIPTS } = await import('./dungeon-ai');
    const { usableNear, useObject } = await import('./dungeon-sim');
    const { s, hx, hy } = make();
    const was = FLOOR_SCRIPTS.get(1);
    let used = 0;
    FLOOR_SCRIPTS.set(1, { ...was, onUse: () => void (used += 1), useLabel: () => 'Рычаг' });
    try {
      const lever = {
        ...wd.objs[0],
        id: 'lever',
        kind: 'deco' as const,
        x: hx + 1,
        y: hy,
        use: { label: 'Рычаг' },
      };
      s.world.objs = [...wd.objs, lever];
      const u = usableNear(s);
      expect(u?.kind).toBe('floor');
      expect(u?.label).toBe('Рычаг');
      expect(useObject(s, u!)).toBe(true);
      expect(used).toBe(1);
    } finally {
      if (was) FLOOR_SCRIPTS.set(1, was);
      else FLOOR_SCRIPTS.delete(1);
    }
  });

  it('E9–E10: камера уходит и возвращается, своё замедление', () => {
    const { s } = make();
    API.camera(s, 10, 10, 0.3);
    expect(s.cam).toBeTruthy();
    for (let i = 0; i < 25; i++) stepSim(s, 1 / 60, idle);
    expect(s.cam).toBeNull();
    API.slowmo(s, 1, 0.25);
    const t0 = s.time;
    stepSim(s, 0.04, idle);
    expect(s.time - t0).toBeCloseTo(0.01, 4);
  });

  it('E13: навес лёг — зона ровно на месте падения', () => {
    const { s, hx, hy } = make();
    const m = spawnMob(s, 'rat', hx - 3.5, hy + 0.5, { mode: 'idle' });
    API.shoot(
      s,
      m,
      0,
      {
        speed: 8,
        r: 0.4,
        life: 2,
        dmg: 0,
        art: 'x',
        lob: true,
        onLand: { r: 1, life: 2, dps: 0.01 },
      },
      hx + 3.5,
      hy + 0.5,
    );
    for (let i = 0; i < 90 && s.shots.length; i++) stepSim(s, 1 / 60, idle);
    expect(s.shots.length).toBe(0);
    const z = s.zones.find((q) => q.r === 1);
    expect(z).toBeTruthy();
    expect(Math.hypot(z!.x - hx - 3.5, z!.y - hy - 0.5)).toBeLessThan(0.3);
  });

  it('E17–E18: радиус поля путей этажа, сброс боя получает api', () => {
    const { s } = make();
    expect(s.flowR).toBe(FLOORS[0].flowR ?? 26);
    const b = s.boss!;
    const was = BOSS_SCRIPTS.get(b.def.script)!;
    let got: unknown = null;
    BOSS_SCRIPTS.set(b.def.script, { ...was, reset: (_s, _b, api) => void (got = api) });
    try {
      b.state = 'fight';
      API.hurtEnv(s, 5);
      expect(got).toBe(API);
      expect(b.state).toBe('idle');
    } finally {
      BOSS_SCRIPTS.set(b.def.script, was);
    }
  });
});

describe('движок анимаций (v2.85)', () => {
  it('кеш кадров вытесняет давно не нужный, а не свежий', () => {
    const c = frameLRU<number>(3);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.get('a')).toBe(1); // «a» снова свежий
    c.set('d', 4);
    expect(c.size).toBe(3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('d')).toBe(4);
  });

  it('приземлившийся удар несёт форму — рисовальщику контакта', () => {
    const wd = buildWorld(1);
    const lift = liftOf(wd, entryArea(1))!;
    const s = createSim({
      world: wd,
      dungeon: DUNGEON_START,
      stats: heroOf(DUNGEON_START),
      x: lift.x + 0.5,
      y: lift.y + 1.5,
      seed: 5,
      now: () => 1e12,
    });
    s.mobs = [];
    API.strike(s, {
      shape: 'cone',
      x: s.hero.x + 5,
      y: s.hero.y,
      r: 2.5,
      ang: 1,
      arc: 2,
      warn: 0.05,
      dmg: 1,
      art: 'test_cleave',
    });
    let got: Extract<SimEvent, { t: 'strike' }> | null = null;
    for (let i = 0; i < 20 && !got; i++) {
      s.events.length = 0;
      stepSim(s, 1 / 60, NO_INPUT);
      for (const e of s.events) if (e.t === 'strike' && e.art === 'test_cleave') got = e;
    }
    expect(got?.s).toEqual({ shape: 'cone', r: 2.5, w: undefined, ang: 1, arc: 2 });
  });
});
