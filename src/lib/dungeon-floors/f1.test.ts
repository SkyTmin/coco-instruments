// Этаж 1 «Крысиные норы»: Крысиный король 2.0 и механики этажа (v2.81).
// Бот — тот же «игрок средней руки», что в `dungeon-sim.test.ts`: видит
// метки на полу и уходит из них с задержкой реакции 0,3 с.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, Tile, walkableTile } from '../dungeon-world';
import {
  API,
  bossBar,
  createSim,
  NO_INPUT,
  spawnMob,
  stepSim,
  strikeHits,
  SWORD,
} from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import { f1State, KING_BARS } from './f1-brains';
import { F1 } from './f1';

const world = buildWorld(1);
const DT = 1 / 60;
const DIAG = !!process.env.DIAG;
const W = world.w;

function dungeon(tier: number, plus: number, extra: Partial<DungeonState> = {}): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, ...extra };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7) {
  const d = dungeon(tier, plus);
  return createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
}

const boss = world.objs.find((o) => o.kind === 'boss')!;
const REACT = 0.3;

function away(hx: number, hy: number, cx: number, cy: number, line?: number) {
  if (line !== undefined) {
    const nx = -Math.sin(line);
    const ny = Math.cos(line);
    const side = (hx - cx) * nx + (hy - cy) * ny >= 0 ? 1 : -1;
    return { x: nx * side, y: ny * side };
  }
  const a = Math.atan2(hy - cy, hx - cx) + 0.5;
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** Бот боя: уходит из меток, бьёт ближнего (латника — со спины), ест. */
function bot(s: Sim, st: { lastAtk: number }): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  const flee = (d: { x: number; y: number }, now: boolean) => {
    inp.mx = d.x;
    inp.my = d.y;
    if (now && h.dashCd <= 0) inp.dash = true;
    return inp;
  };
  if (f1State(s)?.held) return flee({ x: 1, y: 0 }, true);
  for (const m of s.mobs) {
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const def = MOBS[m.kind];
    if (m.mode === 'windup' && m.t > REACT && d < def.reach + m.r + 0.9)
      return flee(away(h.x, h.y, m.x, m.y), true);
    const t = m.tele;
    if (t && t.k > 0.45) {
      const z = {
        shape: t.shape,
        x: t.x ?? m.x,
        y: t.y ?? m.y,
        r: t.r,
        w: t.w,
        ang: t.ang,
        arc: t.arc,
        warn: 1,
        dmg: 0,
      };
      if (strikeHits(z, h.x, h.y, h.r + 0.25))
        return flee(away(h.x, h.y, z.x, z.y, t.shape === 'line' ? t.ang : undefined), t.k > 0.6);
    }
    if (m.mode === 'roll' && d < 3.5) return flee(away(h.x, h.y, m.x, m.y, m.dir), true);
  }
  for (const z of s.strikes) {
    if (z.t < REACT * 0.6 || !strikeHits(z, h.x, h.y, h.r + 0.3)) continue;
    if (z.shape === 'ring' && Math.hypot(h.x - z.x, h.y - z.y) < z.r - (z.w ?? 0.6) - 0.3) continue;
    return flee(away(h.x, h.y, z.x, z.y), z.warn - z.t < 0.3);
  }
  for (const sh of s.shots)
    if (
      sh.lob &&
      sh.age > REACT * 0.5 &&
      Math.hypot(h.x - sh.lob.x1, h.y - sh.lob.y1) < sh.r + h.r + 0.35
    )
      return flee(away(h.x, h.y, sh.lob.x1, sh.lob.y1), sh.lob.T - sh.age < 0.3);
  for (const b of s.bombs)
    if (Math.hypot(b.x - h.x, b.y - h.y) < b.r + 0.6)
      return flee(away(h.x, h.y, b.x, b.y), b.fuse < 0.6);
  const meat = (s.sack.meat.meat ?? 0) + (s.sack.meat.fatmeat ?? 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free') inp.eat = true;
  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge' || m.mode === 'escape') continue;
    if ((m.data.ghost ?? 0) > 0) continue;
    let d = Math.hypot(m.x - h.x, m.y - h.y);
    if (m.kind === 'f1_guard' && ['chase', 'windup', 'bashAim', 'bash'].includes(m.mode)) d += 3;
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near) {
    const real = Math.hypot(near.x - h.x, near.y - h.y);
    let a = Math.atan2(near.y - h.y, near.x - h.x);
    if (near.kind === 'f1_guard' && nd !== real) a += 0.9;
    if (real > SWORD.reach * 0.8) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
    }
    if (real < SWORD.reach + near.r && s.time - st.lastAtk > 0.14) {
      inp.attack = true;
      st.lastAtk = s.time;
    }
  }
  return inp;
}

/** Бой с королём: секунд до победы или −1 (герой пал / время вышло). */
function fight(
  tier: number,
  plus: number,
  seed: number,
  limit = 360,
): { won: number; log: string[] } {
  const s = sim(tier, plus, boss.x + 0.5, boss.y + 4.5, seed);
  const st = { lastAtk: -9 };
  const log: string[] = [];
  for (let t = 0; t < limit * 60; t++) {
    stepSim(s, DT, bot(s, st));
    for (const e of s.events)
      if (e.t === 'boss' && e.text) log.push(`${s.time.toFixed(0)}с ${e.text}`);
    if (s.events.some((e) => e.t === 'boss' && e.what === 'dead')) return { won: s.time, log };
    if (s.hero.mode === 'dead') return { won: -1, log };
  }
  return { won: -1, log };
}

/** Бой начался: герой в арене, король на месте. */
function inFight(seed = 5): Sim {
  const s = sim(2, 3, boss.x + 0.5, boss.y + 4.5, seed);
  stepSim(s, DT, NO_INPUT);
  expect(s.boss!.state).toBe('fight');
  return s;
}

const king = (s: Sim) => s.mobs.find((m) => m.kind === 'king' && m.mode !== 'dying')!;
const god = (s: Sim) => {
  s.hero.inv = 99;
  s.hero.hp = s.stats.maxHp;
};

describe('Крысиный король 2.0', () => {
  it('на Т2+3 бот валит короля за 1–5 минут и погибает не всегда', () => {
    const res = [21, 22, 23, 24].map((seed) => fight(2, 3, seed));
    if (DIAG) for (const r of res) console.log('Т2+3:', r.won.toFixed(0), r.log.join(' · '));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(60);
      expect(r.won).toBeLessThan(300);
    }
  });

  it('на Т1+0 король почти всегда побеждает', () => {
    const res = [31, 32, 33].map((seed) => fight(1, 0, seed, 300));
    if (DIAG) for (const r of res) console.log('Т1+0:', r.won.toFixed(0), r.log.join(' · '));
    expect(res.filter((r) => r.won > 0).length).toBeLessThanOrEqual(1);
  });

  it('четыре полосы: стража на трёх четвертях, раскол ровно на половине, смена оружия на четверти', () => {
    const s = inFight();
    const b = s.boss!;
    const k = king(s);
    const said: string[] = [];
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) {
        god(s);
        stepSim(s, DT, NO_INPUT);
        for (const e of s.events) if (e.t === 'boss') said.push(e.what);
      }
    };
    tick(30);
    expect(b.phase).toBe(0);
    expect(bossBar(s)).toBeCloseTo(1, 2);
    // Полоса I → II: стража из нор арены.
    k.hp = k.maxHp * (KING_BARS[0] - 0.01);
    tick(5);
    expect(b.phase).toBe(1);
    expect(said).toContain('phase');
    tick(90);
    expect(s.mobs.filter((m) => m.kind === 'f1_guard').length).toBe(2);
    // На половине — раскол, а не при смерти.
    expect(s.mobs.filter((m) => m.kind === 'kinglet')).toHaveLength(0);
    k.hp = k.maxHp * (KING_BARS[1] - 0.01);
    tick(5);
    expect(b.phase).toBe(2);
    expect(said).toContain('split');
    expect(s.mobs.filter((m) => m.kind === 'kinglet')).toHaveLength(2);
    // Полоса не прыгает на расколе: малые были в ней запасом с начала.
    const bar = bossBar(s)!;
    expect(bar).toBeGreaterThan(0.55);
    expect(bar).toBeLessThan(0.62);
    // Четверть — смена оружия; после неё ни одного переката.
    k.hp = k.maxHp * (KING_BARS[2] - 0.01);
    tick(5);
    expect(b.phase).toBe(3);
    expect(k.mode).toBe('swap');
    const modes = new Set<string>();
    for (let i = 0; i < 40 * 60; i++) {
      god(s);
      k.hp = Math.max(k.hp, k.maxHp * 0.2);
      stepSim(s, DT, NO_INPUT);
      modes.add(k.mode);
    }
    expect(modes.has('rollAim')).toBe(false);
    expect(modes.has('sweepAim')).toBe(true);
    expect(modes.has('leapAim')).toBe(true);
  });

  it('удары короля видны до попадания: метка на полу и окно уклона', () => {
    const s = inFight(9);
    const k = king(s);
    const seen: Record<string, { tele: boolean; danger: boolean }> = {};
    for (let i = 0; i < 90 * 60; i++) {
      god(s);
      if (i === 45 * 60) k.hp = k.maxHp * 0.2;
      stepSim(s, DT, NO_INPUT);
      const aim: Record<string, string> = { roll: 'rollAim', leap: 'leapAim' };
      const mode = aim[k.mode] ?? k.mode;
      if (['rollAim', 'cleaveAim', 'whipAim', 'sweepAim', 'leapAim'].includes(mode)) {
        const r = (seen[mode] ??= { tele: false, danger: false });
        if (k.tele && k.tele.k > 0) r.tele = true;
        if (k.danger > 0) r.danger = true;
      }
    }
    for (const mode of ['rollAim', 'cleaveAim', 'whipAim', 'sweepAim', 'leapAim']) {
      expect(seen[mode]?.tele, `${mode}: метка`).toBe(true);
      expect(seen[mode]?.danger, `${mode}: окно уклона`).toBe(true);
    }
  });

  it('за победу падает ровно одна корона', () => {
    expect(MOBS.king.mats.some(([id]) => id === 'crown')).toBe(false);
    expect(MOBS.kinglet.mats.some(([id]) => id === 'crown')).toBe(false);
    const s = inFight(3);
    const k = king(s);
    // Добили одним ударом до раскола: малые всё равно отрываются.
    k.hp = 1;
    s.hero.x = k.x + 3;
    API.explode(s, k.x, k.y, 0.5, 99, 0);
    expect(s.boss!.state).toBe('fight');
    expect(s.mobs.filter((m) => m.kind === 'kinglet' && m.mode !== 'dying')).toHaveLength(2);
    for (let i = 0; i < 20; i++) stepSim(s, DT, NO_INPUT);
    for (const m of s.mobs.filter((x) => x.kind === 'kinglet' && x.mode !== 'dying')) {
      m.hp = 1;
      m.data.ghost = 0;
      API.explode(s, m.x, m.y, 0.3, 99, 0);
    }
    expect(s.boss!.state).toBe('won');
    expect(s.drops.filter((d) => d.kind === 'crown').length).toBe(1);
    expect(F1.boss.loot(() => 0.5).mats.crown).toBe(1);
  });

  it('после победы из логова выходят через ворота, и ворота не захлопываются на герое', () => {
    const probe = sim(2, 3, 1, 1, 1);
    const b0 = probe.boss!;
    const cellsIn = [...b0.cells].filter((c) => walkableTile(world.tiles[c]));
    const targets = b0.gates.map((g) => {
      const dist = new Map<number, number>([[g, 0]]);
      const q = [g];
      let best = g;
      while (q.length) {
        const i = q.shift()!;
        for (const d of [1, -1, W, -W]) {
          const j = i + d;
          if (dist.has(j) || b0.cells.has(j) || !walkableTile(world.tiles[j])) continue;
          dist.set(j, dist.get(i)! + 1);
          if (dist.get(j)! <= 5) best = j;
          q.push(j);
        }
      }
      return { gate: g, goal: best };
    });
    const field = (goal: number) => {
      const f = new Int32Array(world.w * world.h).fill(-1);
      const q = [goal];
      f[goal] = 0;
      while (q.length) {
        const i = q.shift()!;
        for (const d of [1, -1, W, -W]) {
          const j = i + d;
          const t = world.tiles[j];
          if (f[j] >= 0 || !(walkableTile(t) || t === Tile.Gate)) continue;
          f[j] = f[i] + 1;
          q.push(j);
        }
      }
      return f;
    };
    let exits = 0;
    for (let k = 0; k < 200; k++) {
      const { gate, goal } = targets[k % targets.length];
      const from = cellsIn[(k * 37) % cellsIn.length];
      const s = sim(2, 3, (from % W) + 0.5, Math.floor(from / W) + 0.5, 100 + k);
      s.boss!.state = 'won';
      s.mobs = [];
      // Ящики, колонны и трон арены живой игрок обходит; тест — про ворота.
      for (const p of s.props)
        if (b0.cells.has(Math.floor(p.y) * W + Math.floor(p.x))) p.alive = false;
      const f = field(goal);
      for (let t = 0; t < 30 * 60; t++) {
        const h = s.hero;
        const i = Math.floor(h.y) * W + Math.floor(h.x);
        let mx = 0;
        let my = 0;
        let bestD = f[i];
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const j = i + dy * W + dx;
          if (f[j] >= 0 && f[j] < bestD) {
            bestD = f[j];
            mx = (j % W) + 0.5 - h.x;
            my = Math.floor(j / W) + 0.5 - h.y;
          }
        }
        if (bestD === f[i]) {
          mx = (goal % W) + 0.5 - h.x;
          my = Math.floor(goal / W) + 0.5 - h.y;
        }
        const n = Math.hypot(mx, my) || 1;
        stepSim(s, DT, { ...NO_INPUT, mx: mx / n, my: my / n });
        s.mobs = [];
        if (Math.hypot((goal % W) + 0.5 - h.x, Math.floor(goal / W) + 0.5 - h.y) < 0.6) break;
      }
      const h = s.hero;
      const atGoal = Math.hypot((goal % W) + 0.5 - h.x, Math.floor(goal / W) + 0.5 - h.y) < 0.8;
      if (atGoal) exits += 1;
      if (atGoal) expect(s.tiles[gate]).toBe(Tile.Gate);
    }
    expect(exits).toBe(200);
  });
});

describe('этаж 1: механики', () => {
  const trap = world.objs.find((o) => o.ref === 'f1_trap' && o.area === 'mouth')!;
  const wire = world.objs.find((o) => o.ref === 'f1_wire' && o.area === 'mouth')!;
  const rattle = world.objs.find((o) => o.ref === 'f1_rattle')!;

  it('капкан: зажал ногу — рывок вырывает, три удара ломают', () => {
    const s = sim(1, 2, trap.x + 0.5, trap.y + 2.5, 2);
    for (let i = 0; i < 70; i++) stepSim(s, DT, NO_INPUT);
    // Шагнули на капкан.
    for (let i = 0; i < 60 && !f1State(s)!.held; i++) stepSim(s, DT, { ...NO_INPUT, my: -1 });
    const st = f1State(s)!;
    expect(st.held).not.toBeNull();
    expect(s.hero.status.stun).toBeDefined();
    // Держит: идти почти нельзя.
    for (let i = 0; i < 60; i++) stepSim(s, DT, { ...NO_INPUT, my: -1 });
    expect(Math.hypot(s.hero.x - trap.x - 0.5, s.hero.y - trap.y - 0.5)).toBeLessThan(0.6);
    // Три удара — капкан разбит.
    let hits = 0;
    for (let i = 0; i < 240 && st.held; i++) {
      const atk = i % 25 === 0;
      if (atk) hits += 1;
      stepSim(s, DT, { ...NO_INPUT, attack: atk });
    }
    expect(st.held).toBeNull();
    expect(st.traps.find((t) => t.p.obj === trap)!.state).toBe('broken');
    expect(hits).toBeLessThanOrEqual(4);

    // Второй раз, другим героем: рывок вырывает сразу.
    const s2 = sim(1, 2, trap.x + 0.5, trap.y + 2.5, 3);
    for (let i = 0; i < 70; i++) stepSim(s2, DT, NO_INPUT);
    for (let i = 0; i < 60 && !f1State(s2)!.held; i++) stepSim(s2, DT, { ...NO_INPUT, my: -1 });
    expect(f1State(s2)!.held).not.toBeNull();
    for (let i = 0; i < 40; i++) stepSim(s2, DT, NO_INPUT);
    stepSim(s2, DT, { ...NO_INPUT, dash: true, mx: 1 });
    expect(f1State(s2)!.held).toBeNull();
    for (let i = 0; i < 30; i++) stepSim(s2, DT, { ...NO_INPUT, mx: 1 });
    expect(Math.hypot(s2.hero.x - trap.x - 0.5, s2.hero.y - trap.y - 0.5)).toBeGreaterThan(1.5);
  });

  it('капкан ловит и крысу: сидит на месте, ранена', () => {
    const s = sim(1, 2, trap.x + 0.5, trap.y + 4.5, 4);
    const r = spawnMob(s, 'rat', trap.x + 0.5, trap.y + 0.5, { mode: 'chase' });
    const hp0 = r.hp;
    for (let i = 0; i < 10; i++) stepSim(s, DT, NO_INPUT);
    expect(r.hp).toBeLessThan(hp0);
    expect(r.hp).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) stepSim(s, DT, NO_INPUT);
    expect(Math.hypot(r.x - trap.x - 0.5, r.y - trap.y - 0.5)).toBeLessThan(0.1);
    // Крысолюд свои капканы знает.
    const s2 = sim(1, 2, trap.x + 0.5, trap.y + 4.5, 4);
    spawnMob(s2, 'f1_ratman', trap.x + 0.5, trap.y + 0.5, { mode: 'chase' });
    for (let i = 0; i < 20; i++) stepSim(s2, DT, NO_INPUT);
    expect(f1State(s2)!.traps.find((t) => t.p.obj === trap)!.state).toBe('armed');
  });

  it('растяжка: зацепил — сверху камни с метками; рывком — перепрыгнул', () => {
    const cells = world.objs.filter(
      (o) => o.ref === 'f1_wire' && o.x === wire.x && o.area === 'mouth',
    );
    const horiz = cells.length === 1;
    const dir = horiz ? { mx: 0, my: -1 } : { mx: 1, my: 0 };
    const sx = wire.x + 0.5 - dir.mx * 2.5;
    const sy = wire.y + 0.5 - dir.my * 2.5;
    const s = sim(1, 2, sx, sy, 5);
    for (let i = 0; i < 70; i++) stepSim(s, DT, NO_INPUT);
    let got = false;
    for (let i = 0; i < 120 && !got; i++) {
      stepSim(s, DT, { ...NO_INPUT, ...dir });
      got = s.strikes.some((z) => z.art === 'f1_rock');
    }
    expect(got).toBe(true);
    expect(s.strikes.filter((z) => z.art === 'f1_rock').length).toBeGreaterThanOrEqual(4);
    expect(s.strikes.every((z) => z.warn >= 0.9)).toBe(true);
    // Рывком над ней — не задел.
    const s2 = sim(1, 2, sx + dir.mx * 1.2, sy + dir.my * 1.2, 5);
    for (let i = 0; i < 70; i++) stepSim(s2, DT, NO_INPUT);
    stepSim(s2, DT, { ...NO_INPUT, ...dir, dash: true });
    for (let i = 0; i < 20; i++) stepSim(s2, DT, NO_INPUT);
    expect(s2.strikes.length).toBe(0);
    expect(f1State(s2)!.wires.some((w) => w.live && w.props.some((p) => p.obj === wire))).toBe(
      true,
    );
  });

  it('гремушка: тревога — из нор сбегается стая', () => {
    const s = sim(2, 3, rattle.x + 0.5, rattle.y + 2.5, 6);
    for (let i = 0; i < 70; i++) stepSim(s, DT, NO_INPUT);
    const before = s.mobs.length;
    let rang = false;
    for (let i = 0; i < 120 && !rang; i++) {
      stepSim(s, DT, { ...NO_INPUT, my: -1 });
      rang = s.events.some((e) => e.t === 'boss' && e.what === 'f1_rattle');
    }
    expect(rang).toBe(true);
    for (let i = 0; i < 60; i++) stepSim(s, DT, NO_INPUT);
    expect(s.mobs.length - before).toBeGreaterThanOrEqual(3);
    expect(s.mobs.some((m) => m.kind === 'f1_ratman')).toBe(true);
  });

  it('Зал черепов: устье заваливает, три волны, после — завал разобран и награда', () => {
    let q = -1;
    const doors: number[] = [];
    for (let i = 0; i < world.mark.length; i++) {
      if (world.mark[i] === 20) q = i;
      if (world.mark[i] === 21) doors.push(i);
    }
    expect(q).toBeGreaterThan(0);
    expect(doors.length).toBeGreaterThan(0);
    const s = sim(2, 5, (q % W) + 0.5, Math.floor(q / W) + 0.5, 8);
    const st = { lastAtk: -9 };
    const waves: string[] = [];
    let closed = false;
    for (let t = 0; t < 200 * 60; t++) {
      god(s);
      stepSim(s, DT, bot(s, st));
      for (const e of s.events) if (e.t === 'boss' && e.what.startsWith('f1_')) waves.push(e.what);
      if (doors.every((i) => s.tiles[i] === Tile.Rubble)) closed = true;
      if (f1State(s)!.hall!.state === 'done') break;
    }
    const hall = f1State(s)!.hall!;
    expect(closed).toBe(true);
    expect(hall.state).toBe('done');
    expect(hall.cleared).toBe(true);
    expect(hall.wave).toBe(3);
    expect(waves).toContain('f1_hall');
    expect(waves).toContain('f1_hall_done');
    expect(doors.every((i) => s.tiles[i] === Tile.Floor)).toBe(true);
    expect(s.drops.some((d) => d.kind === 'f1_charm') || (s.sack.mats.f1_charm ?? 0) > 0).toBe(
      true,
    );
  });

  it('из Зала черепов при засаде не выйти: выход только через устье', () => {
    const hall = f1State(sim(1, 0, 1, 1))!.hall!;
    const doors = new Set(hall.doors);
    for (const i of hall.cells) {
      const x = i % W;
      const y = Math.floor(i / W);
      for (const j of [i + 1, i - 1, i + W, i - W]) {
        if (hall.cells.has(j) || doors.has(j)) continue;
        expect(walkableTile(world.tiles[j]), `щель из зала у ${x},${y}`).toBe(false);
      }
    }
  });

  it('латник: удар в щит звенит и почти не ранит, со спины — в полную', () => {
    const at = { x: 32.5, y: world.bands[0].top + 212.5 };
    const hitFrom = (behind: boolean) => {
      const s = sim(2, 3, at.x - 1.1, at.y, 12);
      for (let i = 0; i < 70; i++) stepSim(s, DT, NO_INPUT);
      const g = spawnMob(s, 'f1_guard', at.x, at.y, { mode: 'chase' });
      g.cd = 9;
      g.data.bashCd = 9;
      g.data.fa = behind ? 0 : Math.PI;
      g.face = g.data.fa;
      s.hero.x = at.x - 1.1;
      s.hero.y = at.y;
      const hp0 = g.hp;
      let clank = false;
      stepSim(s, DT, { ...NO_INPUT, attack: true, aim: { x: 1, y: 0 } });
      for (let i = 0; i < 10; i++) {
        stepSim(s, DT, NO_INPUT);
        if (s.events.some((e) => e.t === 'clank')) clank = true;
      }
      return { lost: hp0 - g.hp, clank };
    };
    const front = hitFrom(false);
    const back = hitFrom(true);
    expect(front.clank).toBe(true);
    expect(back.clank).toBe(false);
    expect(front.lost).toBeLessThan(back.lost * 0.3);
    expect(back.lost).toBeGreaterThan(0);
  });

  it('шаман колдует за спинами; удар сбивает колдовство', () => {
    const at = { x: 32.5, y: world.bands[0].top + 212.5 };
    const setup = (seed: number) => {
      const s = sim(2, 3, at.x - 6, at.y, seed);
      for (let i = 0; i < 70; i++) stepSim(s, DT, NO_INPUT);
      const rats = [0, 1, 2].map((i) =>
        spawnMob(s, 'fatrat', at.x - 2, at.y - 1 + i, { mode: 'chase' }),
      );
      for (const r of rats) r.hp = r.maxHp * 0.3;
      const sh = spawnMob(s, 'f1_shaman', at.x, at.y, { mode: 'chase' });
      sh.cd = 0;
      return { s, rats, sh };
    };
    const a = setup(13);
    let cast = false;
    for (let i = 0; i < 120 && !cast; i++) {
      god(a.s);
      stepSim(a.s, DT, NO_INPUT);
      cast = a.sh.mode === 'cast';
    }
    expect(cast).toBe(true);
    expect(a.s.zones.some((z) => z.art === 'f1_cast_heal')).toBe(true);
    for (let i = 0; i < 90; i++) {
      god(a.s);
      stepSim(a.s, DT, NO_INPUT);
    }
    expect(a.rats.some((r) => r.hp > r.maxHp * 0.5)).toBe(true);

    // Сбили посреди колдовства — лечения нет, круг погас.
    const b = setup(13);
    for (let i = 0; i < 120 && b.sh.mode !== 'cast'; i++) {
      god(b.s);
      stepSim(b.s, DT, NO_INPUT);
    }
    b.s.hero.x = b.sh.x - 1;
    b.s.hero.y = b.sh.y;
    stepSim(b.s, DT, { ...NO_INPUT, attack: true, aim: { x: 1, y: 0 } });
    for (let i = 0; i < 20; i++) stepSim(b.s, DT, NO_INPUT);
    expect(b.s.zones.some((z) => z.art === 'f1_cast_heal')).toBe(false);
    expect(b.rats.every((r) => r.hp <= r.maxHp * 0.31 || r.mode === 'dying')).toBe(true);
  });

  it('пращник кидает навесом: место падения известно заранее', () => {
    const at = { x: 32.5, y: world.bands[0].top + 212.5 };
    const s = sim(2, 3, at.x - 5, at.y, 14);
    for (let i = 0; i < 70; i++) stepSim(s, DT, NO_INPUT);
    const sl = spawnMob(s, 'f1_slinger', at.x, at.y, { mode: 'chase' });
    sl.cd = 0;
    let lob = null as Sim['shots'][number] | null;
    for (let i = 0; i < 180 && !lob; i++) {
      stepSim(s, DT, NO_INPUT);
      lob = s.shots.find((x) => x.lob) ?? null;
    }
    expect(lob).not.toBeNull();
    expect(lob!.lob!.T).toBeGreaterThan(0.35);
    expect(Math.hypot(lob!.lob!.x1 - s.hero.x, lob!.lob!.y1 - s.hero.y)).toBeLessThan(0.8);
  });

  it('крысолюд финтит: половина метки — отскок — полная метка — выпад', () => {
    const at = { x: 32.5, y: world.bands[0].top + 212.5 };
    let sawFeint = false;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = sim(2, 3, at.x - 2.2, at.y, seed);
      for (let i = 0; i < 70; i++) stepSim(s, DT, NO_INPUT);
      const r = spawnMob(s, 'f1_ratman', at.x, at.y, { mode: 'chase' });
      r.cd = 0;
      const seen: string[] = [];
      let maxK = 0;
      for (let i = 0; i < 120; i++) {
        god(s);
        stepSim(s, DT, NO_INPUT);
        if (seen[seen.length - 1] !== r.mode) seen.push(r.mode);
        if (r.mode === 'feint') maxK = Math.max(maxK, r.tele?.k ?? 0);
      }
      if (seen.includes('feint')) {
        sawFeint = true;
        expect(maxK).toBeLessThanOrEqual(0.5);
        expect(seen.indexOf('lunge')).toBeGreaterThan(seen.indexOf('feint'));
        expect(seen).toContain('lungeAim');
      }
    }
    expect(sawFeint).toBe(true);
  });

  it('монстры этажа не застревают в стенах за минуту боя', () => {
    for (const seed of [41, 42]) {
      const at = { x: 32.5, y: world.bands[0].top + 212.5 };
      const s = sim(2, 5, at.x, at.y, seed);
      const kinds = ['f1_ratman', 'f1_slinger', 'f1_shaman', 'f1_guard', 'rat', 'fatrat'];
      kinds.forEach((k, i) => spawnMob(s, k, at.x + 3 + (i % 3), at.y - 2 + i, { mode: 'chase' }));
      const st = { lastAtk: -9 };
      for (let t = 0; t < 60 * 60; t++) {
        god(s);
        stepSim(s, DT, bot(s, st));
        if (t % 10) continue;
        for (const m of s.mobs) {
          if (['dying', 'emerge', 'drop', 'escape'].includes(m.mode) || m.t < 0) continue;
          const tile = s.tiles[Math.floor(m.y) * W + Math.floor(m.x)];
          expect(walkableTile(tile), `${m.kind} в стене (${m.mode})`).toBe(true);
        }
      }
    }
  });
});
