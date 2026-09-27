// Этаж 5 «Лабиринт»: бот против Минотавра, выход с арены, живые стены,
// кролики в траве, феромон муравья, рывки о стену, шипы.
//
// Бот — живой игрок средней руки: видит метки на полу и уходит из них
// рывком за миг до удара (с задержкой реакции), ест, когда здоровья меньше
// 40%, и против Минотавра держит СТРАТЕГИЮ СТЕНЫ: стоит спиной к стене
// арены, уходит в сторону от рывка — бык врезается в кладку и стоит
// оглушённый, тогда бот бьёт.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, liftOf, Tile, walkableTile } from '../dungeon-world';
import { createSim, NO_INPUT, spawnMob, stepSim, strikeHits, SWORD } from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import { f5Births, f5Pockets, f5Walls, pherOn } from './f5-brains';
import { F5_MARK, F5_MAZE } from './f5';

const world = buildWorld(5);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F5LOG;

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 5 };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7, meat = 0): Sim {
  const d = dungeon(tier, plus);
  const s = createSim({
    world,
    dungeon: d,
    stats: heroOf(d),
    x,
    y,
    seed,
    now: () => 1e12,
  });
  if (meat) {
    s.sack.meat.f5_houndmeat = meat;
    s.sack.meatBy[F5_MAZE] = meat;
  }
  return s;
}

/** Поле расстояний до цели — бот идёт по нему. */
function field(tx: number, ty: number): Int32Array {
  const f = new Int32Array(W * world.h).fill(-1);
  const q = [ty * W + tx];
  f[q[0]] = 0;
  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      const t = world.tiles[j];
      if (f[j] >= 0 || !(walkableTile(t) || t === Tile.Gate)) continue;
      f[j] = f[i] + 1;
      q.push(j);
    }
  }
  return f;
}

const solid = (s: Sim, x: number, y: number) => {
  const t = s.tiles[Math.floor(y) * W + Math.floor(x)];
  return !walkableTile(t);
};

function wallBehind(s: Sim, x: number, y: number, ux: number, uy: number, max = 12): number {
  for (let d = 0.3; d <= max; d += 0.3) if (solid(s, x + ux * d, y + uy * d)) return d;
  return max;
}

interface BotState {
  lastAtk: number;
  wall?: boolean;
  /** Реакция на угрозу: от и до, с. */
  react: [number, number];
  /** Доля угроз, которые бот проглядел. */
  miss: number;
  seed: number;
  /** Угроза → [реакция, проглядел]. */
  seen?: Map<string, [number, boolean]>;
}

/** Как бот видит угрозу: своя реакция и изредка — проглядел. */
function notice(st: BotState, key: string): [number, boolean] {
  st.seen ??= new Map();
  let v = st.seen.get(key);
  if (!v) {
    const r = () => {
      st.seed = (Math.imul(st.seed, 1664525) + 1013904223) >>> 0;
      return st.seed / 4294967296;
    };
    v = [st.react[0] + r() * (st.react[1] - st.react[0]), r() < st.miss];
    st.seen.set(key, v);
    if (st.seen.size > 400) st.seen.clear();
  }
  return v;
}

/**
 * Бот. Порядок: метки ударов (уйти рывком за миг до удара) → линии прицела
 * (уйти в сторону) → еда → бой с ближним → путь к цели.
 */
function bot(s: Sim, goal: Int32Array | null, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  // Удары по площади: вот-вот ударит и задевает — рывок наружу.
  for (const z of s.strikes) {
    const left = z.warn - z.t;
    const [react, missed] = notice(st, `s${z.id}`);
    if (missed || z.t < react || !strikeHits(z, h.x, h.y, h.r + 0.25)) continue;
    let ax = h.x - z.x;
    let ay = h.y - z.y;
    if (z.shape === 'cone' && z.ang !== undefined) {
      // Из конуса — вбок от оси.
      const side = Math.sin((z.ang ?? 0) - Math.atan2(ay, ax)) > 0 ? -1 : 1;
      const a = (z.ang ?? 0) + side * 1.9;
      ax = Math.cos(a);
      ay = Math.sin(a);
    }
    const l = Math.hypot(ax, ay) || 1;
    inp.mx = ax / l;
    inp.my = ay / l;
    if (left < 0.22 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Линии прицела мобов (рывок быка, кролика, язык жабы) — вбок.
  for (const m of s.mobs) {
    const t = m.tele;
    if (!t || t.shape !== 'line') continue;
    const [react, missed] = notice(st, `l${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (missed || m.t < react) continue;
    const hit = strikeHits(
      { shape: 'line', x: m.x, y: m.y, r: t.r, w: t.w, ang: t.ang, warn: 1, dmg: 0 },
      h.x,
      h.y,
      h.r + 0.3,
    );
    if (!hit) continue;
    const a = (t.ang ?? 0) + Math.PI / 2;
    const side = Math.cos(a) * (h.x - m.x) + Math.sin(a) * (h.y - m.y) >= 0 ? 1 : -1;
    inp.mx = Math.cos(a) * side;
    inp.my = Math.sin(a) * side;
    if (m.danger > 0 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Бык бежит — не стоять на пути.
  for (const m of s.mobs) {
    if (m.mode !== 'gore' && m.mode !== 'charge') continue;
    if (notice(st, `l${m.id}:${Math.round((s.time - m.t) * 10)}`)[1]) continue;
    const ux = Math.cos(m.dir);
    const uy = Math.sin(m.dir);
    const dx = h.x - m.x;
    const dy = h.y - m.y;
    const along = dx * ux + dy * uy;
    const across = -dx * uy + dy * ux;
    if (along > 0 && along < 5 && Math.abs(across) < m.r + h.r + 0.4) {
      const side = across >= 0 ? 1 : -1;
      inp.mx = -uy * side;
      inp.my = ux * side;
      if (h.dashCd <= 0) inp.dash = true;
      return inp;
    }
  }
  // Замах вплотную — отскок.
  for (const m of s.mobs) {
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (m.mode !== 'windup') continue;
    const [react, missed] = notice(st, `w${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (!missed && m.t > react && d < MOBS[m.kind].reach + m.r + 0.9 && h.dashCd <= 0) {
      const away = Math.atan2(h.y - m.y, h.x - m.x) + 0.9;
      inp.mx = Math.cos(away);
      inp.my = Math.sin(away);
      inp.dash = true;
      return inp;
    }
  }
  // Горит под ногами — отойти.
  for (const z of s.zones) {
    if (!z.dps || z.t < (z.warn ?? 0)) continue;
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d < z.r + h.r) {
      inp.mx = (h.x - z.x) / (d || 1);
      inp.my = (h.y - z.y) / (d || 1);
      return inp;
    }
  }
  const meat = Object.values(s.sack.meat).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) inp.eat = true;

  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge' || (m.data.ghost ?? 0) > 0) continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near && near.kind === 'f5_minotaur' && st.wall) {
    // Стратегия стены: бить только открытого, иначе держать дистанцию
    // спиной к кладке.
    const open = ['dizzy', 'skid', 'recover', 'roar'].includes(near.mode);
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    const reach = SWORD.reach + near.r;
    if (open) {
      if (nd > reach * 0.85) {
        inp.mx = Math.cos(a);
        inp.my = Math.sin(a);
      }
      if (nd < reach + 0.2 && s.time - st.lastAtk > 0.14) {
        inp.attack = true;
        st.lastAtk = s.time;
      }
      return inp;
    }
    if (near.mode === 'aim') return inp;
    const ux = -Math.cos(a);
    const uy = -Math.sin(a);
    const back = wallBehind(s, h.x, h.y, ux, uy);
    if (nd < 4.2 && back > 1.4) {
      inp.mx = ux;
      inp.my = uy;
    } else if (back <= 1.4) {
      // Прижат — вдоль стены.
      inp.mx = -uy;
      inp.my = ux;
    } else if (nd > 6) {
      inp.mx = -ux;
      inp.my = -uy;
    }
    return inp;
  }
  if (near && nd < 7) {
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    if (nd > SWORD.reach * 0.8) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
    }
    if (nd < SWORD.reach + near.r && s.time - st.lastAtk > 0.14) {
      inp.attack = true;
      st.lastAtk = s.time;
    }
    return inp;
  }
  // Горшок или ящик на пути — разбить, как сделал бы живой игрок.
  for (const p of s.props) {
    if (!p.alive || !['crate', 'barrel', 'breakable'].includes(p.kind)) continue;
    if (Math.hypot(p.x - h.x, p.y - h.y) < SWORD.reach + p.r - 0.1 && s.time - st.lastAtk > 0.3) {
      inp.attack = true;
      inp.aim = { x: p.x - h.x, y: p.y - h.y };
      st.lastAtk = s.time;
      return inp;
    }
  }
  if (goal) {
    const cx = Math.floor(h.x);
    const cy = Math.floor(h.y);
    let best = goal[cy * W + cx];
    let bx = 0;
    let by = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const v = goal[(cy + dy) * W + cx + dx];
      if (v >= 0 && v < best) {
        best = v;
        bx = dx;
        by = dy;
      }
    }
    const tx = cx + bx + 0.5 - h.x;
    const ty = cy + by + 0.5 - h.y;
    const l = Math.hypot(tx, ty) || 1;
    inp.mx = tx / l;
    inp.my = ty / l;
  }
  return inp;
}

const bossObj = world.objs.find((o) => o.kind === 'boss')!;

/** Бой с Минотавром: время победы или −1. */
function fight(tier: number, plus: number, seed: number, meat = 4): { won: number; s: Sim } {
  const s = sim(tier, plus, bossObj.x + 0.5, bossObj.y + 6.5, seed, meat);
  const st: BotState = { lastAtk: -9, wall: true, react: [0.22, 0.45], miss: 0.12, seed };
  let won = -1;
  let phase = 0;
  let walls = 0;
  let pillars = 0;
  for (let t = 0; t < 300 * 60; t++) {
    stepSim(s, DT, bot(s, null, st));
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'phase') phase += 1;
      if (e.t === 'boss' && e.what === 'f5_wall') walls += 1;
      if (e.t === 'break' && e.kind === 'crate') pillars += 1;
    }
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  if (LOG)
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фаз ${phase}, в стену ${walls}, колонн ${pillars}, здоровье ${Math.round(s.hero.hp)}/${s.stats.maxHp}`,
    );
  return { won, s };
}

describe('этаж 5: Минотавр', () => {
  it('на Сполохе +3 бот со стратегией стены побеждает за 1–5 минут', () => {
    const res = [41, 42, 43, 44].map((seed) => fight(8, 3, seed).won);
    const wins = res.filter((t) => t > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    for (const t of wins) {
      expect(t).toBeGreaterThan(45);
      expect(t).toBeLessThan(300);
    }
  });

  it('на Сполохе без заточки и без еды — смерть чаще победы', () => {
    const res = [51, 52, 53].map((seed) => fight(8, 0, seed, 0).won);
    expect(res.filter((t) => t > 0).length).toBeLessThanOrEqual(1);
  });
});

describe('этаж 5: арена', () => {
  it('после победы из колизея выходят, ворота не захлопываются на герое', () => {
    const probe = sim(8, 3, 1, 1, 1);
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
    let exits = 0;
    const N = 40;
    for (let k = 0; k < N; k++) {
      const { gate, goal } = targets[k % targets.length];
      const from = cellsIn[(k * 37) % cellsIn.length];
      const s = sim(8, 3, (from % W) + 0.5, Math.floor(from / W) + 0.5, 100 + k);
      s.boss!.state = 'won';
      s.mobs = [];
      // Колонны живой игрок обходит; тест — про ворота.
      for (const p of s.props) if (p.obj.ref === 'f5_pillar') p.alive = false;
      const f = field(goal % W, Math.floor(goal / W));
      const h = s.hero;
      for (let t = 0; t < 30 * 60; t++) {
        const i = Math.floor(h.y) * W + Math.floor(h.x);
        let mx = 0;
        let my = 0;
        let bestD = f[i];
        for (const d of [1, -1, W, -W]) {
          const j = i + d;
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
      const at = Math.hypot((goal % W) + 0.5 - h.x, Math.floor(goal / W) + 0.5 - h.y) < 0.8;
      if (at) {
        exits += 1;
        expect(s.tiles[gate]).toBe(Tile.Gate);
      }
    }
    expect(exits).toBe(N);
  });

  it('рывок в стену оглушает быка: он открыт', () => {
    // Герой спиной к стене арены, бык напротив — рывок кончается в кладке.
    const cells = sim(8, 3, 1, 1, 1).boss!.cells;
    const kx = bossObj.x + 0.5;
    let y = bossObj.y + 0.5;
    while (cells.has(Math.floor(y + 1) * W + Math.floor(kx))) y += 1;
    const s = sim(8, 3, kx, y - 1.2, 3);
    let sawGore = false;
    let dizzy = false;
    for (let t = 0; t < 12 * 60 && !dizzy; t++) {
      s.hero.hp = s.stats.maxHp;
      // Стоит, пока бык целится; в последний миг — в сторону.
      const m = s.mobs.find((x) => x.kind === 'f5_minotaur');
      const inp = { ...NO_INPUT };
      if (m?.mode === 'aim' && m.danger > 0) {
        inp.mx = 1;
        inp.dash = true;
      }
      stepSim(s, DT, inp);
      if (m?.mode === 'gore') sawGore = true;
      if (m?.mode === 'dizzy' && sawGore) dizzy = true;
    }
    expect(sawGore).toBe(true);
    expect(dizzy).toBe(true);
  });

  it('колонна на пути рывка рушится, бык стоит оглушённым дольше', () => {
    const s = sim(8, 3, bossObj.x + 0.5, bossObj.y + 0.5, 4);
    s.hero.inv = 99;
    stepSim(s, DT, NO_INPUT);
    expect(s.boss!.state).toBe('fight');
    const pillar = s.props.find((p) => p.obj.ref === 'f5_pillar')!;
    const m = s.mobs.find((x) => x.kind === 'f5_minotaur')!;
    // Бык по одну сторону колонны, герой по другую — колонна посреди линии.
    const side = solid(s, pillar.x - 3, pillar.y) ? 1 : -1;
    m.x = pillar.x - 3 * side;
    m.y = pillar.y;
    s.hero.x = pillar.x + 2.5 * side;
    s.hero.y = pillar.y;
    m.mode = 'aim';
    m.t = 0;
    m.data.next = 0;
    let broke = false;
    let long = false;
    for (let t = 0; t < 4 * 60; t++) {
      if (m.mode === 'aim') {
        s.hero.x = pillar.x + 2.5 * side;
        s.hero.y = pillar.y;
      }
      stepSim(s, DT, NO_INPUT);
      if (pillar.obj.ref === 'f5_pillar_broken') broke = true;
      if (m.mode === 'dizzy' && m.data.long) long = true;
    }
    expect(broke).toBe(true);
    expect(long).toBe(true);
  });
});

describe('этаж 5: монстры и лабиринт', () => {
  /** Узкие места карты: пол шириной в две клетки между стенами. */
  const narrow: number[] = [];
  for (let y = 2; y < world.h - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (world.tiles[i] !== Tile.Floor) continue;
      const open = (j: number) => walkableTile(world.tiles[j]);
      const horiz = !open(i - 1) && open(i + 1) && !open(i + 2);
      const vert = !open(i - W) && open(i + W) && !open(i + 2 * W);
      if (horiz || vert) narrow.push(i);
    }

  it('монстры этажа не застревают в стенах узких коридоров', () => {
    expect(narrow.length).toBeGreaterThan(50);
    const kinds = ['f5_rabbit', 'f5_hound', 'f5_ant', 'f5_shade', 'f5_frog'];
    let stuck = 0;
    let checks = 0;
    for (let k = 0; k < 6; k++) {
      const i = narrow[(k * 97 + 13) % narrow.length];
      const x = (i % W) + 0.5;
      const y = Math.floor(i / W) + 0.5;
      const s = sim(8, 5, x, y, 60 + k, 6);
      s.hero.inv = 3;
      for (let j = 0; j < 5; j++) {
        const kind = kinds[(k + j) % kinds.length];
        const a = (j / 5) * Math.PI * 2;
        let mx = x + Math.cos(a) * 3;
        let my = y + Math.sin(a) * 3;
        for (let r = 0; r < 20 && solid(s, mx, my); r++) {
          mx = x + (mx - x) * 0.8;
          my = y + (my - y) * 0.8;
        }
        spawnMob(s, kind, mx, my, { mode: 'chase' });
      }
      const st: BotState = { lastAtk: -9, react: [0.25, 0.4], miss: 0.1, seed: k + 1 };
      for (let t = 0; t < 40 * 60; t++) {
        stepSim(s, DT, bot(s, null, st));
        if (t % 10) continue;
        for (const m of s.mobs) {
          if (m.mode === 'dying' || m.mode === 'emerge' || m.t < 0) continue;
          checks += 1;
          if (solid(s, m.x, m.y)) stuck += 1;
        }
        if (s.hero.mode === 'dead') break;
      }
    }
    expect(checks).toBeGreaterThan(500);
    expect(stuck).toBe(0);
  });

  it('живые стены рожают: трещина видна до выхода, новорождённый недосягаем', () => {
    const lift = liftOf(world, F5_MAZE)!;
    const s = sim(8, 5, lift.x + 0.5, lift.y + 0.5, 9, 8);
    expect(f5Walls(s).length).toBeGreaterThan(40);
    const up = field(34, bandTop(F5_MAZE) + 1);
    const st: BotState = { lastAtk: -9, react: [0.25, 0.4], miss: 0.1, seed: 5 };
    let births = 0;
    let crackFirst = true;
    let bornGhost = true;
    const zoneAt = new Map<string, number>();
    for (let t = 0; t < 150 * 60; t++) {
      stepSim(s, DT, bot(s, up, st));
      for (const z of s.zones)
        if (z.art === 'f5_birth') {
          const key = `${Math.floor(z.x)}:${Math.floor(z.y)}`;
          if (!zoneAt.has(key)) zoneAt.set(key, s.time);
        }
      for (const m of s.mobs)
        if (m.mode === 'f5_born' && m.data.wx !== undefined) {
          if (m.t < 0.5 && !(m.data.ghost > 0)) bornGhost = false;
          if (m.t <= DT * 1.01) {
            births += 1;
            const at = zoneAt.get(`${m.data.wx}:${m.data.wy}`);
            if (at === undefined || s.time - at < 0.9) crackFirst = false;
          }
        }
      if (s.hero.mode === 'dead') break;
    }
    if (LOG) console.log(`рождений из стен: ${births}, убито ${s.killed}`);
    expect(births).toBeGreaterThanOrEqual(3);
    expect(crackFirst).toBe(true);
    expect(bornGhost).toBe(true);
  });

  it('кролики сидят в траве невидимыми и выпрыгивают, когда подходишь', () => {
    const lift = liftOf(world, F5_MAZE)!;
    const s0 = sim(8, 5, 1, 1, 12);
    // Заросли подальше от лифта; встать в 9–11 шагах от их середины.
    const p = f5Pockets(s0).find((q) => Math.hypot(q.cx - lift.x, q.cy - lift.y) > 25)!;
    const f = field(Math.floor(p.cx), Math.floor(p.cy));
    let start = -1;
    for (let j = 0; j < f.length && start < 0; j++)
      if (f[j] >= 9 && f[j] <= 11 && world.mark[j] !== F5_MARK.grass) start = j;
    const s = sim(8, 5, (start % W) + 0.5, Math.floor(start / W) + 0.5, 12);
    s.hero.inv = 99;
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    const hidden = s.mobs.filter((m) => m.kind === 'f5_rabbit' && m.mode === 'f5_hide');
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((m) => m.data.ghost === 1)).toBe(true);
    // Идти к ближнему — выскакивает с рывком.
    const r = hidden[0];
    const toR = field(Math.floor(r.x), Math.floor(r.y));
    let charged = false;
    const st: BotState = { lastAtk: -9, react: [9, 9], miss: 1, seed: 1 };
    for (let t = 0; t < 10 * 60 && !charged; t++) {
      s.hero.inv = 99;
      const inp = bot(s, toR, st);
      stepSim(s, DT, { ...inp, attack: false, dash: false });
      if (r.mode === 'charge') charged = true;
    }
    expect(charged).toBe(true);
    expect(r.data.ghost).toBe(0);
  });

  it('укус муравья метит феромоном: муравьи бегут, из стен лезут новые, метка спадает', () => {
    const lift = liftOf(world, F5_MAZE)!;
    const s0 = sim(8, 5, 1, 1, 13);
    const all = f5Walls(s0);
    // Место, вокруг которого больше всего живых стен в 3–10 клетках.
    let wall = all[0];
    let most = -1;
    for (const w of all) {
      if (Math.hypot(w.ox - lift.x, w.oy - lift.y) < 30) continue;
      const n = all.filter((o) => {
        const d = Math.hypot(o.ox - w.ox, o.oy - w.oy);
        return d > 3 && d < 10;
      }).length;
      if (n > most) {
        most = n;
        wall = w;
      }
    }
    const s = sim(8, 5, wall.ox + 0.5, wall.oy + 0.5, 13);
    for (let t = 0; t < 70; t++) stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    const ant = spawnMob(s, 'f5_ant', s.hero.x, s.hero.y, { mode: 'chase' });
    ant.data.bcd = 0;
    let marked = false;
    for (let t = 0; t < 5 * 60 && !marked; t++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.hp = s.stats.maxHp;
      marked = pherOn(s);
    }
    expect(marked).toBe(true);
    let aura = false;
    let antBirths = 0;
    let rushOk = true;
    for (let t = 0; t < 7 * 60; t++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.hp = s.stats.maxHp;
      if (s.zones.some((z) => z.art === 'f5_pher')) aura = true;
      antBirths = Math.max(antBirths, f5Births(s).filter((b) => b.kind === 'f5_ant').length);
      if (pherOn(s))
        for (const m of s.mobs)
          if (m.kind === 'f5_ant' && m.mode === 'chase' && !m.rush) rushOk = false;
    }
    expect(aura).toBe(true);
    expect(antBirths).toBeGreaterThan(0);
    expect(rushOk).toBe(true);
    // Метка спадает, если больше не кусают.
    for (let t = 0; t < 12 * 60; t++) {
      s.mobs = [];
      stepSim(s, DT, NO_INPUT);
    }
    expect(pherOn(s)).toBe(false);
    expect(s.zones.some((z) => z.art === 'f5_pher')).toBe(false);
  });

  it('гончая дышит огнём конусом с меткой и поджигает', () => {
    const s = sim(8, 5, 1, 1, 14);
    // Открытое место: пол, свободный на три клетки вправо.
    const i = narrow.find(
      (j) =>
        [1, 2, 3].every((k) => walkableTile(world.tiles[j + k])) &&
        world.rowArea[Math.floor(j / W)] === F5_MAZE,
    )!;
    s.hero.x = (i % W) + 0.5;
    s.hero.y = Math.floor(i / W) + 0.5;
    for (let t = 0; t < 70; t++) stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    const hd = spawnMob(s, 'f5_hound', s.hero.x + 2.4, s.hero.y, { mode: 'chase' });
    hd.cd = 0;
    hd.data.bcd = 99;
    let cone = false;
    let burned = false;
    for (let t = 0; t < 3 * 60; t++) {
      s.hero.x = (i % W) + 0.5;
      s.hero.y = Math.floor(i / W) + 0.5;
      stepSim(s, DT, NO_INPUT);
      if (s.strikes.some((z) => z.art === 'f5_fire' && z.shape === 'cone')) cone = true;
      if (s.hero.status.burn) burned = true;
      s.hero.hp = s.stats.maxHp;
    }
    expect(cone).toBe(true);
    expect(burned).toBe(true);
  });

  it('жаба притягивает языком', () => {
    const s = sim(8, 5, 1, 1, 15);
    const i = narrow.find((j) => [1, 2, 3, 4, 5].every((k) => walkableTile(world.tiles[j + k])))!;
    s.hero.x = (i % W) + 0.5;
    s.hero.y = Math.floor(i / W) + 0.5;
    for (let t = 0; t < 70; t++) stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    const fr = spawnMob(s, 'f5_frog', s.hero.x + 4, s.hero.y, { mode: 'chase' });
    fr.cd = 0;
    const x0 = s.hero.x;
    let lashed = false;
    let pulled = 0;
    for (let t = 0; t < 3 * 60; t++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.hp = s.stats.maxHp;
      if (s.zones.some((z) => z.art === 'f5_tongue')) lashed = true;
      pulled = Math.max(pulled, s.hero.x - x0);
    }
    expect(lashed).toBe(true);
    expect(pulled).toBeGreaterThan(0.6);
  });

  it('раненая тень уходит в стену и выходит из живой стены', () => {
    const lift = liftOf(world, F5_MAZE)!;
    const s0 = sim(8, 5, 1, 1, 16);
    const walls = f5Walls(s0).filter((w) => Math.hypot(w.ox - lift.x, w.oy - lift.y) > 30);
    const wall = walls[3];
    const s = sim(8, 5, wall.ox + 0.5, wall.oy + 0.5, 16);
    s.hero.inv = 99;
    for (let t = 0; t < 70; t++) stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    const sh = spawnMob(s, 'f5_shade', s.hero.x, s.hero.y, { mode: 'chase' });
    sh.hp = sh.maxHp * 0.45;
    let gone = false;
    let back = false;
    let fromWall = false;
    for (let t = 0; t < 6 * 60; t++) {
      s.hero.inv = 99;
      stepSim(s, DT, NO_INPUT);
      if (sh.mode === 'f5_gone') gone = true;
      if (gone && sh.mode === 'f5_born') {
        back = true;
        if (sh.data.wx !== undefined) fromWall = true;
      }
    }
    expect(gone).toBe(true);
    expect(back).toBe(true);
    expect(fromWall).toBe(true);
  });

  it('плита с шипами бьёт через миг после шага, а не сразу', () => {
    const spike = [...Array(world.h * W).keys()].find((i) => world.mark[i] === F5_MARK.spike)!;
    const s = sim(8, 5, (spike % W) + 0.5, Math.floor(spike / W) + 0.5, 17);
    s.hero.inv = 0;
    const hp0 = s.hero.hp;
    stepSim(s, DT, NO_INPUT);
    expect(s.strikes.some((z) => z.art === 'f5_spike')).toBe(true);
    for (let t = 0; t < 20; t++) stepSim(s, DT, NO_INPUT);
    expect(s.hero.hp).toBe(hp0);
    for (let t = 0; t < 20; t++) stepSim(s, DT, NO_INPUT);
    expect(s.hero.hp).toBeLessThan(hp0);
    // Около десятой части здоровья — на любой броне.
    expect(hp0 - s.hero.hp).toBeGreaterThan(s.stats.maxHp * 0.07);
    expect(hp0 - s.hero.hp).toBeLessThan(s.stats.maxHp * 0.13);
  });

  it('лабиринт проходим: от лифта до ворот колизея на Сполохе +5 с едой', () => {
    const lift = liftOf(world, F5_MAZE)!;
    const gate = world.objs.find((o) => o.kind === 'gate')!;
    const goal = field(gate.x, gate.y + 3);
    let arrived = 0;
    for (const seed of [71, 72, 73]) {
      const s = sim(8, 5, lift.x + 0.5, lift.y + 0.5, seed, 10);
      const st: BotState = { lastAtk: -9, react: [0.22, 0.4], miss: 0.1, seed };
      let t = 0;
      for (; t < 420 * 60; t++) {
        stepSim(s, DT, bot(s, goal, st));
        if (Math.hypot(s.hero.x - gate.x - 0.5, s.hero.y - gate.y - 3.5) < 1.5) break;
        if (s.hero.mode === 'dead') break;
      }
      if (LOG)
        console.log(
          `путь ${seed}: ${s.hero.mode === 'dead' ? 'погиб' : `${(t / 60).toFixed(0)} с`}, убито ${s.killed}`,
        );
      if (s.hero.mode !== 'dead' && t < 420 * 60) arrived += 1;
    }
    expect(arrived).toBeGreaterThanOrEqual(2);
  });
});

function bandTop(area: string): number {
  return world.bands.find((b) => b.def.id === area)!.top;
}
