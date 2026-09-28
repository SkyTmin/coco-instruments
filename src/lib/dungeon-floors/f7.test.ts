// Этаж 7 «Зеркальный лабиринт»: бот против Отражения героя, выход с арены,
// монстры не застревают, зеркала рожают, отражение повторяет героя и его
// взмах, голем трескается и сыплет осколки, копия невидима за спиной,
// тень из рамы, вспышка бабочки, нить паука, луч призмы от зеркала,
// зеркала-переходы, ложные проходы, большое зеркало, Зал призм, фазы босса.
//
// Бот — живой игрок средней руки: видит метки на полу и уходит из них
// рывком за миг до удара (с задержкой реакции и изредка проглядев), ест,
// когда здоровья меньше 40%, бьёт в окна (после серии, выпада, тяжёлого),
// не бьёт в зеркальную стойку, поворачивается к невидимой копии, а в фазе
// теней ищет настоящего — по тени (в тесте — по виду моба).

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, liftOf, Tile, walkableTile } from '../dungeon-world';
import { API, createSim, NO_INPUT, spawnMob, stepSim, strikeHits, SWORD } from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import {
  beamPath,
  ECHO_LAG,
  F7_NOTCHES,
  f7State,
  FLASH_T,
  GOLEM_CRACKS,
  T,
  WARP_DWELL,
} from './f7-brains';
import { F7_CRYSTAL, F7_GALLERY, F7_HALL, F7_MARK } from './f7';

const world = buildWorld(7);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F7LOG;

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 7 };
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
    s.sack.meat.f7_jelly = meat;
    s.sack.meatBy[F7_GALLERY] = meat;
  }
  return s;
}

/** Поле расстояний до цели — бот идёт по нему. */
function field(tx: number, ty: number, tiles: ArrayLike<number> = world.tiles): Int32Array {
  const f = new Int32Array(W * world.h).fill(-1);
  const q = [ty * W + tx];
  f[q[0]] = 0;
  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      if (j < 0 || j >= f.length) continue;
      const t = tiles[j];
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

const bandTop = (area: string) => world.bands.find((b) => b.def.id === area)!.top;

interface BotState {
  lastAtk: number;
  react: [number, number];
  miss: number;
  seed: number;
  seen?: Map<string, [number, boolean]>;
  /** Бой с отражением: бить только в окна. */
  duel?: boolean;
}

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

/** Задевает ли метка моба героя (круг, конус, кольцо, линия). */
function teleHits(m: Mob, x: number, y: number, r: number): boolean {
  const t = m.tele!;
  return strikeHits(
    {
      shape: t.shape,
      x: t.x ?? m.x,
      y: t.y ?? m.y,
      r: t.r,
      w: t.w,
      ang: t.ang,
      arc: t.arc,
      warn: 1,
      dmg: 0,
    },
    x,
    y,
    r,
  );
}

/** Видно ли по прямой (стены, но не пропасть). */
function lineOfSightT(s: Sim, ax: number, ay: number, bx: number, by: number): boolean {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
  for (let i = 1; i < n; i++) {
    const t =
      s.tiles[Math.floor(ay + ((by - ay) * i) / n) * W + Math.floor(ax + ((bx - ax) * i) / n)];
    if (!walkableTile(t) && t !== Tile.Deep) return false;
  }
  return true;
}

const OPEN = ['recover', 'intro', 'idle', 'chase', 'daze'];

function bot(s: Sim, goal: Int32Array | null, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  // Удары по площади: вот-вот ударит и задевает — наружу, рывком в последний миг.
  for (const z of s.strikes) {
    const left = z.warn - z.t;
    const [react, missed] = notice(st, `s${z.id}`);
    if (missed || z.t < react || !strikeHits(z, h.x, h.y, h.r + 0.25)) continue;
    let ax = h.x - z.x;
    let ay = h.y - z.y;
    if ((z.shape === 'cone' || z.shape === 'line') && z.ang !== undefined) {
      const side = Math.sin(z.ang - Math.atan2(ay, ax)) > 0 ? -1 : 1;
      const a = z.ang + side * (z.shape === 'line' ? Math.PI / 2 : 1.9);
      ax = Math.cos(a);
      ay = Math.sin(a);
    }
    const l = Math.hypot(ax, ay) || 1;
    inp.mx = ax / l;
    inp.my = ay / l;
    if (left < 0.24 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Метки мобов (линии, конусы, круги, кольца) — уйти из них.
  for (const m of s.mobs) {
    const t = m.tele;
    if (!t || m.mode === 'dying') continue;
    const [react, missed] = notice(st, `t${m.id}:${m.mode}:${Math.round((s.time - m.t) * 10)}`);
    if (missed || m.t < react) continue;
    if (!teleHits(m, h.x, h.y, h.r + 0.3)) continue;
    const cx = t.x ?? m.x;
    const cy = t.y ?? m.y;
    let a: number;
    if (t.shape === 'line') {
      const n = (t.ang ?? 0) + Math.PI / 2;
      const side = Math.cos(n) * (h.x - cx) + Math.sin(n) * (h.y - cy) >= 0 ? 1 : -1;
      a = n + (side < 0 ? Math.PI : 0);
    } else if (t.shape === 'cone') {
      const side = Math.sin((t.ang ?? 0) - Math.atan2(h.y - cy, h.x - cx)) > 0 ? -1 : 1;
      a = (t.ang ?? 0) + side * 1.9;
    } else a = Math.atan2(h.y - cy, h.x - cx);
    inp.mx = Math.cos(a);
    inp.my = Math.sin(a);
    if (m.danger > 0 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Выпад бежит — не стоять на пути.
  for (const m of s.mobs) {
    if (m.mode !== 'dash' && m.mode !== 'mrun') continue;
    if (notice(st, `r${m.id}:${Math.round((s.time - m.t) * 10)}`)[1]) continue;
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
    if (m.mode !== 'windup') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const [react, missed] = notice(st, `w${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (!missed && m.t > react && d < MOBS[m.kind].reach + m.r + 0.9 && h.dashCd <= 0) {
      const away = Math.atan2(h.y - m.y, h.x - m.x) + 0.9;
      inp.mx = Math.cos(away);
      inp.my = Math.sin(away);
      inp.dash = true;
      return inp;
    }
  }
  // Режет под ногами — отойти.
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

  // Цель: в бою — настоящее отражение; иначе ближний досягаемый.
  const boss = s.mobs.find((m) => m.kind === 'f7boss' && m.mode !== 'dying');
  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge' || m.mode === 'escape') continue;
    if (st.duel && m.kind === 'f7boss_copy') continue;
    // За стеной лабиринта, а обход далёк — живой игрок идёт дальше.
    const fl = s.flow[Math.floor(m.y) * W + Math.floor(m.x)];
    if ((fl < 0 || fl > 14) && !lineOfSightT(s, h.x, h.y, m.x, m.y)) continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (st.duel && boss) {
    near = boss;
    nd = Math.hypot(boss.x - h.x, boss.y - h.y);
  }
  if (near && (near.data.ghost ?? 0) > 0 && near.kind === 'f7_phantom' && nd < 5) {
    // Невидимая копия — повернуться к ней лицом.
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    inp.mx = Math.cos(a) * 0.4;
    inp.my = Math.sin(a) * 0.4;
    return inp;
  }
  if (near && st.duel && near.kind === 'f7boss') {
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    const reach = SWORD.reach + near.r;
    const open = OPEN.includes(near.mode) && !(near.data.ghost > 0);
    if (open) {
      if (nd > reach * 0.8) {
        inp.mx = Math.cos(a);
        inp.my = Math.sin(a);
      }
      if (nd < reach + 0.2 && s.time - st.lastAtk > 0.14) {
        inp.attack = true;
        inp.aim = { x: Math.cos(a), y: Math.sin(a) };
        st.lastAtk = s.time;
      }
      return inp;
    }
    // Не окно: держать дистанцию 2,6–4 клетки.
    if (nd < 2.6) {
      inp.mx = -Math.cos(a);
      inp.my = -Math.sin(a);
    } else if (nd > 4.5) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
    }
    return inp;
  }
  if (near && nd < 7 && !((near.data.ghost ?? 0) > 0)) {
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    if (nd > SWORD.reach * 0.8) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
    }
    if (nd < SWORD.reach + near.r && s.time - st.lastAtk > 0.14 && near.mode !== 'guard') {
      inp.attack = true;
      inp.aim = { x: Math.cos(a), y: Math.sin(a) };
      st.lastAtk = s.time;
    }
    return inp;
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

/** Бой с отражением: время победы или −1. */
function fight(
  tier: number,
  plus: number,
  seed: number,
  meat = 4,
): { won: number; s: Sim; phases: number; copies: number; clanks: number; low: number } {
  const s = sim(tier, plus, bossObj.x + 0.5, bossObj.y + 5.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.22, 0.45], miss: 0.12, seed, duel: true };
  let won = -1;
  let phases = 0;
  let copies = 0;
  let clanks = 0;
  const at: number[] = [];
  const tally = new Map<string, number>();
  let minHp = 1e9;
  let ate = 0;
  for (let t = 0; t < 300 * 60; t++) {
    stepSim(s, DT, bot(s, null, st));
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'phase') {
        phases += 1;
        at.push(Math.round(s.time));
      }
      if (e.t === 'clank') clanks += 1;
      if (e.t === 'eat') ate += 1;
    }
    minHp = Math.min(minHp, s.hero.hp);
    copies = Math.max(copies, s.mobs.filter((m) => m.kind === 'f7boss_copy').length);
    if (LOG) {
      const b = s.mobs.find((m) => m.kind === 'f7boss');
      if (b) {
        const key = `${s.boss?.phase}:${b.mode}`;
        tally.set(key, (tally.get(key) ?? 0) + DT);
      }
    }
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  if (LOG)
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фазы на ${at.join('/')} с, копий до ${copies}, звона ${clanks}, здоровье ${Math.round(s.hero.hp)}/${s.stats.maxHp} (мин ${Math.round((100 * minHp) / s.stats.maxHp)}%, съел ${ate}), босс ${Math.round((100 * (s.mobs.find((m) => m.kind === 'f7boss')?.hp ?? 0)) / (s.mobs.find((m) => m.kind === 'f7boss')?.maxHp ?? 1))}%`,
    );
  if (LOG)
    console.log(
      [...tally.entries()]
        .sort()
        .map(([k, v]) => `${k} ${v.toFixed(0)}`)
        .join(', '),
    );
  return { won, s, phases, copies, clanks, low: minHp / s.stats.maxHp };
}

describe('этаж 7: карта и числа', () => {
  it('клетки движка повторены верно', () => {
    expect(T.Wall).toBe(Tile.Wall);
    expect(T.Floor).toBe(Tile.Floor);
    expect(T.Deep).toBe(Tile.Deep);
    expect(T.Hazard).toBe(Tile.Hazard);
  });

  it('три района, 220–320 рядов, свои клетки — больше шести видов в каждом', () => {
    const f = world.bands;
    expect(f.map((b) => b.def.id).sort()).toEqual([F7_GALLERY, F7_CRYSTAL, F7_HALL].sort());
    expect(world.h).toBeGreaterThanOrEqual(220);
    expect(world.h).toBeLessThanOrEqual(320);
    for (const b of f) {
      const kinds = new Set<number>();
      for (let y = b.top; y < b.top + b.h; y++)
        for (let x = 0; x < W; x++) if (world.mark[y * W + x]) kinds.add(world.mark[y * W + x]);
      expect(kinds.size, b.def.id).toBeGreaterThanOrEqual(6);
    }
  });

  it('пары зеркал-переходов — ровно по две рамы одного цвета', () => {
    const refs = world.objs.filter((o) => o.ref?.startsWith('f7_portal')).map((o) => o.ref!);
    const count = new Map<string, number>();
    for (const r of refs) count.set(r, (count.get(r) ?? 0) + 1);
    expect(count.size).toBeGreaterThanOrEqual(3);
    for (const n of count.values()) expect(n).toBe(2);
  });
});

describe('этаж 7: Отражение героя', () => {
  it('на Сполохе +5 бот побеждает за 1–5 минут, проходя все фазы', () => {
    const res = (process.env.F7SEEDS ? [41, 42, 43, 44, 45, 46, 47, 48] : [41, 42, 43, 44]).map(
      (seed) => fight(8, 5, seed),
    );
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    // Не каждый раз без смертей: бой опасен — хоть в одном прогоне герой
    // погиб или стоял на краю (меньше пятой части здоровья).
    expect(res.some((r) => r.won < 0 || r.low < 0.2)).toBe(true);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(60);
      expect(r.won).toBeLessThan(300);
      expect(r.phases).toBe(3);
      expect(r.copies).toBeGreaterThanOrEqual(3);
    }
  });

  it('на Сполохе без заточки и без еды — смерть чаще победы', () => {
    const res = [51, 52, 53].map((seed) => fight(8, 0, seed, 0).won);
    expect(res.filter((t) => t > 0).length).toBeLessThanOrEqual(1);
  });

  it('засечки фаз на полосе — три', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 0.5, 3);
    s.hero.inv = 99;
    stepSim(s, DT, NO_INPUT);
    expect(s.boss!.state).toBe('fight');
    expect(F7_NOTCHES.length).toBe(3);
  });

  it('фаза теней: копии звенят и рассыпаются от удара, у настоящего — тень', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 0.5, 5);
    s.hero.inv = 99;
    stepSim(s, DT, NO_INPUT);
    const lead = s.mobs.find((m) => m.kind === 'f7boss')!;
    lead.hp = lead.maxHp * (F7_NOTCHES[0] - 0.01);
    for (let t = 0; t < 90; t++) {
      s.hero.inv = 99;
      stepSim(s, DT, NO_INPUT);
    }
    expect(s.boss!.phase).toBe(1);
    const copies = s.mobs.filter((m) => m.kind === 'f7boss_copy' && m.mode !== 'dying');
    expect(copies.length).toBe(3);
    expect(s.zones.some((z) => z.art === 'f7_trueshadow')).toBe(true);
    // Удар по копии: урона нет, звон, копия рассыпается.
    const c = copies[0];
    for (let t = 0; t < 30; t++) {
      s.hero.inv = 99;
      stepSim(s, DT, NO_INPUT);
    }
    s.hero.x = c.x - 0.9;
    s.hero.y = c.y;
    const hp0 = lead.hp;
    let clank = 0;
    for (let t = 0; t < 20 && c.mode !== 'dying'; t++) {
      c.data.ghost = 0;
      c.mode = c.mode === 'shift' ? 'chase' : c.mode;
      s.hero.inv = 99;
      stepSim(s, DT, { ...NO_INPUT, attack: t === 0, aim: { x: 1, y: 0 } });
      clank += s.events.filter((e) => e.t === 'clank').length;
    }
    expect(c.mode).toBe('dying');
    expect(clank).toBeGreaterThan(0);
    expect(lead.hp).toBe(hp0);
  });

  it('последняя фаза: осколки летят линиями из зеркал, зеркала трескаются, сброс их чинит', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 0.5, 6);
    s.hero.inv = 99;
    stepSim(s, DT, NO_INPUT);
    const lead = s.mobs.find((m) => m.kind === 'f7boss')!;
    for (const k of [F7_NOTCHES[0] - 0.01, F7_NOTCHES[1] - 0.01, F7_NOTCHES[2] - 0.01]) {
      lead.hp = lead.maxHp * k;
      for (let t = 0; t < 30; t++) {
        s.hero.inv = 99;
        stepSim(s, DT, NO_INPUT);
      }
    }
    expect(s.boss!.phase).toBe(3);
    let lines = 0;
    for (let t = 0; t < 6 * 60; t++) {
      s.hero.inv = 99;
      stepSim(s, DT, NO_INPUT);
      lines = Math.max(lines, s.strikes.filter((z) => z.art === 'f7_shardline').length);
    }
    expect(lines).toBeGreaterThanOrEqual(5);
    const cracked = f7State(s)!.cracked.size;
    expect(cracked).toBeGreaterThanOrEqual(5);
    // Герой пал — бой сброшен, зеркала снова целы.
    s.hero.inv = 0;
    s.hero.hp = 1;
    API.hurtHero(s, 1e9, s.hero.x + 1, s.hero.y, 0);
    for (let t = 0; t < 10; t++) stepSim(s, DT, NO_INPUT);
    expect(f7State(s)!.cracked.size).toBe(0);
    for (const i of f7State(s)!.arenaMirrors) expect(s.world.mark[i]).toBe(F7_MARK.arena);
    expect(s.mobs.some((m) => m.kind === 'f7boss_copy')).toBe(false);
  });

  it('после победы из арены выходят, ворота не захлопываются на герое', () => {
    const probe = sim(8, 5, 1, 1, 1);
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
          if (dist.get(j)! <= 4) best = j;
          q.push(j);
        }
      }
      return { gate: g, goal: best };
    });
    let exits = 0;
    const N = 30;
    for (let k = 0; k < N; k++) {
      const { gate, goal } = targets[k % targets.length];
      const from = cellsIn[(k * 37) % cellsIn.length];
      const s = sim(8, 5, (from % W) + 0.5, Math.floor(from / W) + 0.5, 100 + k);
      s.boss!.state = 'won';
      s.mobs = [];
      for (const p of s.props) if (p.obj.ref === 'f7_pillar') p.alive = false;
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
});

describe('этаж 7: монстры', () => {
  /** Узкие места карты: пол шириной в две клетки между стенами. */
  const narrow: number[] = [];
  for (let y = 2; y < world.h - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (!walkableTile(world.tiles[i])) continue;
      const open = (j: number) => walkableTile(world.tiles[j]);
      const horiz = !open(i - 1) && open(i + 1) && !open(i + 2);
      const vert = !open(i - W) && open(i + W) && !open(i + 2 * W);
      if (horiz || vert) narrow.push(i);
    }

  /** Открытое место района: пол, свободный на `r` клеток во все стороны. */
  function openSpot(area: string, r = 3, skip = 0): [number, number] {
    const b = world.bands.find((x) => x.def.id === area)!;
    let n = 0;
    for (let y = b.top + 3; y < b.top + b.h - 3; y++)
      for (let x = 3; x < W - 3; x++) {
        let ok = true;
        for (let dy = -r; dy <= r && ok; dy++)
          for (let dx = -r; dx <= r && ok; dx++)
            if (!walkableTile(world.tiles[(y + dy) * W + x + dx])) ok = false;
        if (ok && world.objs.every((o) => Math.hypot(o.x - x, o.y - y) > r)) {
          if (n++ >= skip) return [x + 0.5, y + 0.5];
        }
      }
    throw new Error('нет места');
  }

  it('монстры этажа не застревают в стенах и пропасти', () => {
    expect(narrow.length).toBeGreaterThan(50);
    const kinds = [
      'f7_echo',
      'f7_golem',
      'f7_phantom',
      'f7_moth',
      'f7_spider',
      'f7_prism',
      'f7_thief',
    ];
    let stuck = 0;
    let checks = 0;
    for (let k = 0; k < 6; k++) {
      const i = narrow[(k * 97 + 13) % narrow.length];
      const x = (i % W) + 0.5;
      const y = Math.floor(i / W) + 0.5;
      const s = sim(8, 5, x, y, 60 + k, 6);
      s.hero.inv = 3;
      for (let j = 0; j < 6; j++) {
        const kind = kinds[(k + j) % kinds.length];
        const a = (j / 6) * Math.PI * 2;
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
          const fly = MOBS[m.kind].fly;
          const tile = s.tiles[Math.floor(m.y) * W + Math.floor(m.x)];
          checks += 1;
          if (fly ? tile !== Tile.Deep && solid(s, m.x, m.y) : solid(s, m.x, m.y)) stuck += 1;
        }
        if (s.hero.mode === 'dead') break;
      }
    }
    expect(checks).toBeGreaterThan(500);
    expect(stuck).toBe(0);
  });

  it('зеркала рожают: фигура в зеркале видна до выхода, вышедший недосягаем', () => {
    const [x, y] = openSpot(F7_GALLERY, 2, 40);
    const s = sim(8, 5, x, y, 9, 8);
    expect(f7State(s)!.mirrors.length).toBeGreaterThan(60);
    const st: BotState = { lastAtk: -9, react: [0.25, 0.4], miss: 0.1, seed: 5 };
    const up = field(31, 1);
    let births = 0;
    let warnFirst = true;
    let ghostOk = true;
    const at = new Map<string, number>();
    for (let t = 0; t < 120 * 60; t++) {
      stepSim(s, DT, bot(s, up, st));
      for (const z of s.zones)
        if (z.art === 'f7_birth') {
          const key = `${Math.floor(z.x)}:${Math.floor(z.y)}`;
          if (!at.has(key)) at.set(key, s.time);
        }
      for (const m of s.mobs)
        if (m.mode === 'f7_step' && m.data.mx !== undefined && m.t <= DT * 1.01) {
          births += 1;
          const z = at.get(`${m.data.mx}:${m.data.my}`);
          if (z !== undefined && s.time - z < 0.9) warnFirst = false;
        } else if (m.mode === 'f7_step' && m.t < 0.4 && !(m.data.ghost > 0)) ghostOk = false;
      if (s.hero.mode === 'dead') break;
    }
    if (LOG) console.log(`рождений из зеркал: ${births}, убито ${s.killed}`);
    expect(births).toBeGreaterThanOrEqual(3);
    expect(warnFirst).toBe(true);
    expect(ghostOk).toBe(true);
  });

  it('отражение повторяет движения героя зеркально и его взмах — через миг', () => {
    const [x, y] = openSpot(F7_GALLERY, 4);
    const s = sim(8, 5, x, y + 2, 11);
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    const e = spawnMob(s, 'f7_echo', x, y - 2, { mode: 'mirror' });
    e.data.axis = 0;
    e.data.a = y;
    e.data.lx = e.x;
    e.data.ly = e.y;
    // Герой идёт вправо — отражение тоже вправо (ось горизонтальная).
    const ex0 = e.x;
    for (let t = 0; t < 50; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, { ...NO_INPUT, mx: 1 });
    }
    for (let t = 0; t < 40; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
    }
    expect(e.x - ex0).toBeGreaterThan(1.2);
    // Отражение по другую сторону оси — зеркально по вертикали.
    expect(Math.sign(e.y - e.data.a)).toBe(-Math.sign(s.hero.y - e.data.a));
    // Взмах героя: отражение в «копии», метка сразу, удар через ECHO_LAG.
    s.hero.x = e.x;
    s.hero.y = e.y + 1.3;
    e.mode = 'mirror';
    e.t = 0.1;
    let copied = false;
    let teleFirst = false;
    for (let t = 0; t < 40 && !copied; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, { ...NO_INPUT, attack: t === 0, aim: { x: 0, y: -1 } });
      if (e.mode === 'copy') {
        copied = true;
        teleFirst = e.tele !== null || e.t < DT * 2;
      }
    }
    expect(copied).toBe(true);
    expect(teleFirst).toBe(true);
    expect(ECHO_LAG).toBeGreaterThanOrEqual(0.35);
  });

  it('голем трескается: осколки веером на пороге, треснувший хрупче', () => {
    const [x, y] = openSpot(F7_GALLERY, 4, 3);
    const s = sim(8, 5, x, y + 3, 12);
    s.hero.inv = 99;
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    const g = spawnMob(s, 'f7_golem', x, y, { mode: 'chase' });
    g.hp = g.maxHp * (GOLEM_CRACKS[0] - 0.02);
    let shards = 0;
    for (let t = 0; t < 90; t++) {
      s.hero.inv = 99;
      stepSim(s, DT, NO_INPUT);
      shards = Math.max(shards, s.shots.filter((q) => q.art === 'f7_shard').length);
    }
    expect(g.data.cracks).toBe(1);
    expect(shards).toBeGreaterThanOrEqual(6);
  });

  it('призрачная копия недосягаема, пока на неё не смотрят, её касание переворачивает', () => {
    const [x, y] = openSpot(F7_HALL, 3);
    const s = sim(8, 5, x, y, 13);
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    const p = spawnMob(s, 'f7_phantom', x + 3, y, { mode: 'chase' });
    p.cd = 99;
    // Смотрит влево — копия справа невидима.
    s.hero.face = Math.PI;
    stepSim(s, DT, NO_INPUT);
    expect(p.data.ghost).toBe(1);
    s.hero.face = 0;
    stepSim(s, DT, NO_INPUT);
    expect(p.data.ghost).toBe(0);
    // Касание: очарован.
    p.cd = 0;
    let charm = false;
    for (let t = 0; t < 3 * 60 && !charm; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      if (s.hero.status.charm) charm = true;
    }
    expect(charm).toBe(true);
  });

  it('пустая рама: дрожит, выпускает тень; разбил раму — тень рассеялась', () => {
    const frame = world.objs.find((o) => o.ref === 'f7_frame' && o.area === F7_GALLERY)!;
    const s = sim(8, 5, frame.x + 0.5, frame.y + 3.5, 14);
    s.hero.inv = 99;
    let stir = false;
    let shadow: Mob | undefined;
    for (let t = 0; t < 3 * 60 && !shadow; t++) {
      s.hero.inv = 99;
      stepSim(s, DT, NO_INPUT);
      if (s.zones.some((z) => z.art === 'f7_stir')) stir = true;
      shadow = s.mobs.find((m) => m.kind === 'f7_shadow');
    }
    expect(stir).toBe(true);
    expect(shadow).toBeTruthy();
    const prop = s.props.find((p) => p.obj === frame)!;
    prop.hp = 0;
    prop.alive = false;
    for (let t = 0; t < 10; t++) stepSim(s, DT, NO_INPUT);
    expect(shadow!.mode).toBe('dying');
  });

  it('вспышка бабочки слепит того, кто смотрит, и не трогает отвернувшегося', () => {
    const [x, y] = openSpot(F7_GALLERY, 4, 7);
    const run = (face: number) => {
      const s = sim(8, 5, x, y, 15);
      for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
      s.mobs = [];
      s.hero.inv = 0;
      const m = spawnMob(s, 'f7_moth', x + 1.6, y, { mode: 'flash' });
      m.cd = 99;
      for (let t = 0; t < (FLASH_T + 0.2) * 60; t++) {
        s.hero.face = face;
        s.hero.x = x;
        s.hero.y = y;
        m.x = x + 1.6;
        m.y = y;
        stepSim(s, DT, NO_INPUT);
      }
      return !!s.hero.status.chill;
    };
    expect(run(0)).toBe(true);
    expect(run(Math.PI)).toBe(false);
  });

  it('нить паука: задел — режет, лопается, пауки падают сверху', () => {
    const s0 = sim(8, 5, 1, 1, 16);
    const th = f7State(s0)!.threads;
    expect(th.length).toBeGreaterThanOrEqual(4);
    const t0 = th[0];
    // Встать в шаге от нити и идти сквозь неё.
    const horiz = Math.abs(t0.y1 - t0.y0) < 0.01;
    const s = sim(8, 5, t0.cx + 0.5 + (horiz ? 0 : -1.5), t0.cy + 0.5 + (horiz ? -1.5 : 0), 16);
    for (let t = 0; t < 10; t++) stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    let spiders = 0;
    for (let t = 0; t < 2 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, { ...NO_INPUT, mx: horiz ? 0 : 1, my: horiz ? 1 : 0 });
      spiders = Math.max(spiders, s.mobs.filter((m) => m.kind === 'f7_spider').length);
    }
    const t1 = f7State(s)!.threads[0];
    expect(t1.broken).toBe(true);
    expect(spiders).toBeGreaterThan(0);
  });

  it('луч призмы отражается от зеркала', () => {
    const s = sim(8, 5, 1, 1, 17);
    // Точка пола прямо под зеркалом: луч вверх бьёт в зеркало и уходит вниз.
    const st = f7State(s)!;
    const m = st.mirrors.find((q) => !solid(s, q.ox + 0.5, q.oy + 2.5))!;
    const segs = beamPath(s, m.ox + 0.5, m.oy + 2.5, -Math.PI / 2 + 0.3, 12, 2);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(Math.sin(segs[1].ang)).toBeGreaterThan(0);
  });

  it('зеркала-переходы: постоял — вспышка в парной раме, и герой там', () => {
    const s0 = sim(8, 5, 1, 1, 18);
    const ends = f7State(s0)!.portals.filter((p) => p.pair === 1);
    expect(ends.length).toBe(2);
    const s = sim(8, 5, ends[0].x, ends[0].y, 18);
    s.hero.inv = 99;
    let flash = false;
    let warped = false;
    for (let t = 0; t < 60; t++) {
      s.mobs = [];
      stepSim(s, DT, NO_INPUT);
      if (
        s.zones.some(
          (z) => z.art === 'f7_warp' && Math.hypot(z.x - ends[1].x, z.y - ends[1].y) < 0.5,
        )
      )
        flash = flash || !warped;
      if (Math.hypot(s.hero.x - ends[1].x, s.hero.y - ends[1].y) < 0.8) warped = true;
    }
    expect(flash).toBe(true);
    expect(warped).toBe(true);
    expect(WARP_DWELL).toBeGreaterThan(0.3);
  });

  it('ложный проход — зеркало: упёрся — треснуло; иллюзию проходят насквозь', () => {
    const fake = [...Array(W * world.h).keys()].find(
      (i) => world.mark[i] === F7_MARK.fake && walkableTile(world.tiles[i + W]),
    )!;
    const fx = fake % W;
    const fy = Math.floor(fake / W);
    const s = sim(8, 5, fx + 0.5, fy + 2.2, 19);
    s.hero.inv = 99;
    for (let t = 0; t < 90; t++) {
      s.mobs = [];
      stepSim(s, DT, { ...NO_INPUT, my: -1 });
    }
    expect(s.world.mark[fake]).toBe(F7_MARK.cracked);
    expect(s.tiles[fake]).toBe(Tile.Wall);
    const ill = [...Array(W * world.h).keys()].filter((i) => world.mark[i] === F7_MARK.illusion);
    expect(ill.length).toBeGreaterThan(0);
    for (const i of ill) expect(walkableTile(world.tiles[i])).toBe(true);
  });

  it('большое зеркало: разбил — за ним ход, из осколков лезут отражения', () => {
    const big = world.objs.find((o) => o.ref === 'f7_bigmirror')!;
    const s = sim(8, 5, big.x + 0.5, big.y + 2.5, 20);
    s.hero.inv = 99;
    const behind = [...Array(W * world.h).keys()].filter((i) => world.mark[i] === F7_MARK.behind);
    expect(behind.length).toBeGreaterThan(3);
    for (const i of behind) expect(s.tiles[i]).toBe(Tile.Wall);
    for (let t = 0; t < 12 * 60; t++) {
      s.hero.inv = 99;
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, { ...NO_INPUT, attack: t % 20 === 0, aim: { x: 0, y: -1 } });
      if (!s.props.find((p) => p.obj === big)!.alive) break;
    }
    expect(s.props.find((p) => p.obj === big)!.alive).toBe(false);
    let risen = 0;
    for (let t = 0; t < 4 * 60; t++) {
      s.hero.inv = 99;
      stepSim(s, DT, NO_INPUT);
      risen = Math.max(risen, s.mobs.filter((m) => m.kind === 'f7_echo').length);
    }
    for (const i of behind) expect(s.tiles[i]).toBe(Tile.Floor);
    expect(risen).toBeGreaterThanOrEqual(2);
  });

  it('Зал призм: хрусталь запирает выходы, разбил призмы — выходы открыты', () => {
    const s0 = sim(8, 5, 1, 1, 21);
    const hall = f7State(s0)!.hall!;
    expect(hall).toBeTruthy();
    const s = sim(8, 5, hall.cx, hall.cy + 1.5, 21);
    s.hero.inv = 99;
    let closed = false;
    for (let t = 0; t < 3 * 60; t++) {
      s.hero.inv = 99;
      stepSim(s, DT, NO_INPUT);
      if (hall.seams.every((i) => s.tiles[i] === Tile.Wall)) closed = true;
      if (closed) break;
    }
    expect(closed).toBe(true);
    for (let t = 0; t < 2 * 60; t++) {
      s.hero.inv = 99;
      stepSim(s, DT, NO_INPUT);
    }
    const prisms = s.mobs.filter((m) => m.kind === 'f7_prism');
    expect(prisms.length).toBe(3);
    for (const m of prisms) m.hp = 0.01;
    // Добить: удары по призмам.
    for (
      let t = 0;
      t < 20 * 60 && s.mobs.some((m) => m.kind === 'f7_prism' && m.mode !== 'dying');
      t++
    ) {
      s.hero.inv = 99;
      const p = s.mobs.find((m) => m.kind === 'f7_prism' && m.mode !== 'dying');
      if (p) {
        s.hero.x = p.x - 0.8;
        s.hero.y = p.y;
        p.data.ghost = 0;
      }
      stepSim(s, DT, { ...NO_INPUT, attack: t % 15 === 0, aim: { x: 1, y: 0 } });
    }
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    expect(hall.seams.every((i) => walkableTile(s.tiles[i]))).toBe(true);
  });

  it('этаж проходим: от лифта до ворот арены на Сполохе +5 с едой', () => {
    const lift = liftOf(world, F7_GALLERY)!;
    const gate = world.objs.find((o) => o.kind === 'gate')!;
    const goal = field(gate.x, gate.y + 3);
    let arrived = 0;
    for (const seed of [71, 72, 73]) {
      const s = sim(8, 5, lift.x + 0.5, lift.y + 0.5, seed, 10);
      const st: BotState = { lastAtk: -9, react: [0.22, 0.4], miss: 0.1, seed };
      let t = 0;
      const trail: [string, string][] = [];
      for (; t < 480 * 60; t++) {
        stepSim(s, DT, bot(s, goal, st));
        if (LOG && t % (30 * 60) === 0) {
          const near = s.mobs
            .filter((m) => m.mode !== 'dying')
            .map((m) => [m, Math.hypot(m.x - s.hero.x, m.y - s.hero.y)] as const)
            .sort((a, b) => a[1] - b[1])
            .slice(0, 3)
            .map(([m, d]) => `${m.kind}/${m.mode}/${d.toFixed(1)}${m.data.ghost ? 'g' : ''}`)
            .join(' ');
          trail.push([
            `${(t / 60).toFixed(0)}s ${s.hero.x.toFixed(1)},${s.hero.y.toFixed(1)} hp ${Math.round(s.hero.hp)}`,
            near,
          ]);
        }
        if (Math.hypot(s.hero.x - gate.x - 0.5, s.hero.y - gate.y - 3.5) < 1.5) break;
        if (s.hero.mode === 'dead') break;
      }
      if (LOG)
        console.log(
          `путь ${seed}: ${s.hero.mode === 'dead' ? 'погиб' : `${(t / 60).toFixed(0)} с`}, убито ${s.killed}, y ${s.hero.y.toFixed(0)}`,
        );
      if (LOG) for (const [k, v] of trail) console.log(`  ${k}`, v);
      if (s.hero.mode !== 'dead' && t < 480 * 60) arrived += 1;
    }
    expect(arrived).toBeGreaterThanOrEqual(2);
  });
});

void bandTop;
