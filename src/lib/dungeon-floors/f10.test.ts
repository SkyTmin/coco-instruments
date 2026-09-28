// Этаж 10 «Трон демона»: бот против Короля демонов, выход с арены, обвал
// краёв и его откат, и механики монстров и районов — посты, цепи псов,
// камень горгулий, рыцарь в бездне, чары суккубы, шипы Врат, мост, гроза
// Витражного зала, сокровищница.
//
// Бот — живой игрок средней руки: видит метки на полу и уходит из них
// рывком за миг до удара (с задержкой реакции и изредка проглядев), ест,
// когда здоровья меньше 40%. Против короля: пока тот на троне — бьёт
// стражу и ждёт, когда король позовёт (тогда он открыт); встал — бьёт его.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, Tile, walkableTile } from '../dungeon-world';
import { API, createSim, NO_INPUT, spawnMob, stepSim, strikeHits, SWORD } from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import { f10Events, f10Posts, KING, KNIGHT } from './f10-brains';
import { F10_GALLERY, F10_GATES, F10_MARK, F10_THRONE } from './f10';

const world = buildWorld(10);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F10LOG;

const band = (id: string) => world.bands.find((b) => b.def.id === id)!;
/** Мировая клетка по местным координатам района. */
const at = (area: string, x: number, y: number): [number, number] => [x, band(area).top + y];

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 10 };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7, meat = 0): Sim {
  const d = dungeon(tier, plus);
  const s = createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
  if (meat) {
    s.sack.meat.f10_hellmeat = meat;
    s.sack.meatBy[F10_THRONE] = meat;
  }
  return s;
}

const solidAt = (s: Sim, x: number, y: number) => {
  const t = s.tiles[Math.floor(y) * W + Math.floor(x)];
  return !walkableTile(t);
};

interface BotState {
  lastAtk: number;
  react: [number, number];
  miss: number;
  seed: number;
  seen?: Map<string, [number, boolean]>;
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

/** Клетка пола рядом, куда можно уйти, не на трещине и не у края. */
const safeFloor = (s: Sim, x: number, y: number) => {
  const i = Math.floor(y) * W + Math.floor(x);
  const t = s.tiles[i];
  if (!walkableTile(t)) return false;
  const mk = s.world.mark[i];
  return mk !== F10_MARK.cracking;
};

function bot(s: Sim, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  // Удары по площади: вот-вот ударит и задевает — рывок наружу.
  for (const z of s.strikes) {
    const left = z.warn - z.t;
    const [react, missed] = notice(st, `s${z.id}`);
    if (missed || z.t < react || !strikeHits(z, h.x, h.y, h.r + 0.25)) continue;
    let ax = h.x - z.x;
    let ay = h.y - z.y;
    if ((z.shape === 'cone' || z.shape === 'line') && z.ang !== undefined) {
      const side = Math.sin((z.ang ?? 0) - Math.atan2(ay, ax)) > 0 ? -1 : 1;
      const a = (z.ang ?? 0) + side * (z.shape === 'line' ? Math.PI / 2 : 1.9);
      ax = Math.cos(a);
      ay = Math.sin(a);
    }
    if (z.shape === 'ring') {
      // Из кольца — туда, где ближе край: внутрь или наружу.
      const d = Math.hypot(ax, ay) || 1;
      if (d < z.r) {
        ax = -ax;
        ay = -ay;
      }
    }
    const l = Math.hypot(ax, ay) || 1;
    inp.mx = ax / l;
    inp.my = ay / l;
    // Не рваться рывком в пропасть или на трещину.
    if (!safeFloor(s, h.x + inp.mx * 2.2, h.y + inp.my * 2.2)) {
      inp.mx = -inp.my;
      inp.my = ax / l;
    }
    if (left < 0.22 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Линии прицела (рыцарь, гончая) — вбок.
  for (const m of s.mobs) {
    const t = m.tele;
    if (!t || t.shape !== 'line') continue;
    const [react, missed] = notice(st, `l${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (missed || m.t < react) continue;
    const hit = strikeHits({ shape: 'line', x: m.x, y: m.y, r: t.r, w: t.w, ang: t.ang, warn: 1, dmg: 0 }, h.x, h.y, h.r + 0.3);
    if (!hit) continue;
    const a = (t.ang ?? 0) + Math.PI / 2;
    const side = Math.cos(a) * (h.x - m.x) + Math.sin(a) * (h.y - m.y) >= 0 ? 1 : -1;
    inp.mx = Math.cos(a) * side;
    inp.my = Math.sin(a) * side;
    if (m.danger > 0 && h.dashCd <= 0) inp.dash = true;
    return inp;
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
  // Трещит под ногами или жжёт — отойти.
  const here = Math.floor(h.y) * W + Math.floor(h.x);
  if (s.world.mark[here] === F10_MARK.cracking) {
    const b = s.boss;
    const cx = b ? b.obj.x + 0.5 : h.x;
    const cy = b ? b.obj.y + 3.5 : h.y;
    const l = Math.hypot(cx - h.x, cy - h.y) || 1;
    inp.mx = (cx - h.x) / l;
    inp.my = (cy - h.y) / l;
    return inp;
  }
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

  // Цель: король, когда открыт; иначе ближняя стража; иначе ждать.
  let near: Mob | null = null;
  let nd = 1e9;
  let king: Mob | null = null;
  for (const m of s.mobs) {
    if (m.kind === 'f10boss') king = m;
    if (m.mode === 'dying' || m.mode === 'emerge' || (m.data.ghost ?? 0) > 0) continue;
    if (m.kind === 'f10boss' && m.mode === 'f10_throne') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const w = m.kind === 'f10boss' && m.mode === 'f10_command' ? d - 6 : d;
    if (w < nd) {
      nd = w;
      near = m;
    }
  }
  if (near) nd = Math.hypot(near.x - h.x, near.y - h.y);
  if (near && nd < 12) {
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    if (nd > SWORD.reach * 0.8 + near.r * 0.5) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
    }
    if (nd < SWORD.reach + near.r && s.time - st.lastAtk > 0.14) {
      inp.attack = true;
      inp.aim = { x: near.x - h.x, y: near.y - h.y };
      st.lastAtk = s.time;
    }
    return inp;
  }
  if (king && king.mode === 'f10_throne') {
    // Ждать зова в трёх-четырёх клетках перед помостом.
    const tx = king.x;
    const ty = king.y + 4;
    const l = Math.hypot(tx - h.x, ty - h.y);
    if (l > 0.8) {
      inp.mx = (tx - h.x) / l;
      inp.my = (ty - h.y) / l;
    }
  }
  return inp;
}

const bossObj = world.objs.find((o) => o.kind === 'boss')!;

interface Fight {
  won: number;
  s: Sim;
  phases: number;
  low: number;
}

function fight(tier: number, plus: number, seed: number, meat = 4): Fight {
  const s = sim(tier, plus, bossObj.x + 0.5, bossObj.y + 7.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.22, 0.45], miss: 0.12, seed };
  let won = -1;
  let phases = 0;
  let low = 1;
  const seenModes = new Map<string, number>();
  for (let t = 0; t < 360 * 60; t++) {
    stepSim(s, DT, bot(s, st));
    low = Math.min(low, s.hero.hp / s.stats.maxHp);
    const k = s.mobs.find((m) => m.kind === 'f10boss');
    if (k) seenModes.set(k.mode, (seenModes.get(k.mode) ?? 0) + DT);
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'phase') phases += 1;
    }
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  if (LOG) {
    const k = s.mobs.find((m) => m.kind === 'f10boss');
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фаз ${phases}, король ${k ? Math.round((100 * k.hp) / k.maxHp) : 0}%, минимум здоровья ${Math.round(low * 100)}%, мяса ${s.sack.meat.f10_hellmeat ?? 0}`,
      [...seenModes].map(([m, v]) => `${m}:${v.toFixed(0)}`).join(' '),
    );
  }
  return { won, s, phases, low };
}

describe('этаж 10: Король демонов', () => {
  it('на Т8+5 с едой бот побеждает за 1–5 минут, проходя все фазы', () => {
    const res = [41, 42, 43, 44].map((seed) => fight(8, 5, seed));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(60);
      expect(r.won).toBeLessThan(300);
      expect(r.phases).toBe(3);
    }
    // Не прогулка: хоть раз король доводит бота до края или побеждает.
    expect(res.some((r) => r.won < 0 || r.low < 0.45)).toBe(true);
  });

  it('на Т8+0 без еды — смерть чаще победы', () => {
    const res = [51, 52, 53].map((seed) => fight(8, 0, seed, 0).won);
    expect(res.filter((t) => t > 0).length).toBeLessThanOrEqual(1);
  });
});

describe.runIf(!!process.env.F10SWEEP)('этаж 10: подбор', () => {
  it('сетка снаряжения', () => {
    for (const [tier, plus, meat] of (process.env.F10SWEEP ?? '').split(';').map((x) => x.split(',').map(Number)))
      for (const seed of [61, 62, 63]) fight(tier, plus, seed, meat);
  });
});

// ---------------------------------------------------------------------------
// Арена.
// ---------------------------------------------------------------------------

/** Поле расстояний до цели — бот идёт по нему. */
function field(tx: number, ty: number, tiles: Uint8Array = world.tiles): Int32Array {
  const f = new Int32Array(W * world.h).fill(-1);
  const q = [ty * W + tx];
  f[q[0]] = 0;
  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      const t = tiles[j];
      if (f[j] >= 0 || !(walkableTile(t) || t === Tile.Gate)) continue;
      f[j] = f[i] + 1;
      q.push(j);
    }
  }
  return f;
}

/** Шаг по полю к меньшему числу. */
function follow(s: Sim, f: Int32Array, gx: number, gy: number): SimInput {
  const h = s.hero;
  const i = Math.floor(h.y) * W + Math.floor(h.x);
  let mx = gx + 0.5 - h.x;
  let my = gy + 0.5 - h.y;
  let bestD = f[i];
  for (const d of [1, -1, W, -W]) {
    const j = i + d;
    if (f[j] >= 0 && f[j] < bestD) {
      bestD = f[j];
      mx = (j % W) + 0.5 - h.x;
      my = Math.floor(j / W) + 0.5 - h.y;
    }
  }
  const n = Math.hypot(mx, my) || 1;
  return { ...NO_INPUT, mx: mx / n, my: my / n };
}

/** Довести до фазы «Бездна» и дать краю рушиться. */
function toAbyss(s: Sim, secs: number): void {
  const h = s.hero;
  for (let t = 0; t < secs * 60; t++) {
    h.hp = s.stats.maxHp;
    const k = s.mobs.find((m) => m.kind === 'f10boss');
    const b = s.boss!;
    if (k && b.state === 'fight' && b.phase < 3) {
      b.phase = 2;
      k.hp = k.maxHp * 0.25;
      if (k.mode.startsWith('f10_') && k.mode !== 'f10_roar') k.mode = 'chase';
    }
    // Стража не мешает: тест — про пол.
    s.mobs = s.mobs.filter((m) => m.kind === 'f10boss');
    stepSim(s, DT, NO_INPUT);
  }
}

describe('этаж 10: тронный зал', () => {
  it('после победы из зала выходят, ворота не захлопываются на герое', () => {
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
          if (dist.get(j)! <= 5) best = j;
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
      // Колонны и жаровни живой игрок обходит; тест — про ворота.
      for (const p of s.props) if (p.r > 0 && p.kind === 'deco') p.alive = false;
      const f = field(goal % W, Math.floor(goal / W));
      const h = s.hero;
      for (let t = 0; t < 40 * 60; t++) {
        stepSim(s, DT, follow(s, f, goal % W, Math.floor(goal / W)));
        s.mobs = [];
        if (Math.hypot((goal % W) + 0.5 - h.x, Math.floor(goal / W) + 0.5 - h.y) < 0.6) break;
      }
      if (Math.hypot((goal % W) + 0.5 - h.x, Math.floor(goal / W) + 0.5 - h.y) < 0.8) {
        exits += 1;
        expect(s.tiles[gate]).toBe(Tile.Gate);
      }
    }
    expect(exits).toBe(N);
  });

  it('в «Бездне» край зала рушится кольцами, ковёр и дорога к воротам целы', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 6.5, 5);
    const b = s.boss!;
    const before = [...b.cells].filter((i) => s.tiles[i] === Tile.Deep).length;
    toAbyss(s, 2);
    expect(b.phase).toBe(3);
    // Первое кольцо трещит, но ещё стоит — есть время уйти.
    const cracking = [...b.cells].filter((i) => s.world.mark[i] === F10_MARK.cracking);
    expect(cracking.length).toBeGreaterThan(20);
    expect(cracking.every((i) => s.tiles[i] !== Tile.Deep)).toBe(true);
    toAbyss(s, 20);
    const deep = [...b.cells].filter((i) => s.tiles[i] === Tile.Deep);
    expect(deep.length - before).toBeGreaterThan(60);
    const gateCols = b.gates.map((g) => g % W);
    for (const i of deep) {
      expect([F10_MARK.carpet, F10_MARK.dais]).not.toContain(world.mark[i]);
      expect(i % W >= Math.min(...gateCols) - 1 && i % W <= Math.max(...gateCols) + 1).toBe(false);
    }
    // От трона до ворот путь есть.
    const f = field(b.gates[0] % W, Math.floor(b.gates[0] / W), s.tiles);
    expect(f[(bossObj.y + 3) * W + bossObj.x]).toBeGreaterThan(0);
  });

  it('герой на рушащемся краю не падает насквозь: его сносит на целую плиту', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 6.5, 6);
    const b = s.boss!;
    toAbyss(s, 1.5);
    const edge = [...b.cells].find((i) => s.world.mark[i] === F10_MARK.cracking)!;
    s.hero.x = (edge % W) + 0.5;
    s.hero.y = Math.floor(edge / W) + 0.5;
    let fell = false;
    for (let t = 0; t < 4 * 60; t++) {
      s.hero.inv = 0;
      s.mobs = s.mobs.filter((m) => m.kind === 'f10boss');
      stepSim(s, DT, NO_INPUT);
      if (s.events.some((e) => e.t === 'boss' && e.what === 'f10_edge_trap')) fell = true;
    }
    expect(fell).toBe(true);
    expect(walkableTile(s.tiles[Math.floor(s.hero.y) * W + Math.floor(s.hero.x)])).toBe(true);
    expect(s.hero.hp).toBeGreaterThan(0);
  });

  it('смерть в бою возвращает зал целым, новый бой после победы — тоже', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 6.5, 7);
    const b = s.boss!;
    const tiles0 = s.tiles.slice();
    const marks0 = s.world.mark.slice();
    toAbyss(s, 12);
    expect([...b.cells].some((i) => s.tiles[i] !== tiles0[i])).toBe(true);
    // Смерть: король отдыхает, зал — как был.
    s.hero.inv = 0;
    API.hurtHero(s, s.stats.maxHp * 50, s.hero.x, s.hero.y, 0);
    expect(b.state).toBe('idle');
    for (const i of b.cells) {
      if (b.gates.includes(i)) continue;
      expect(s.tiles[i]).toBe(tiles0[i]);
      expect(s.world.mark[i]).toBe(marks0[i]);
    }
    // Победа оставляет зал обрушенным, новый бой начинается в целом.
    const s2 = sim(8, 5, bossObj.x + 0.5, bossObj.y + 6.5, 8);
    const b2 = s2.boss!;
    toAbyss(s2, 12);
    b2.state = 'won';
    s2.mobs = [];
    expect([...b2.cells].filter((i) => s2.tiles[i] !== tiles0[i]).length).toBeGreaterThan(0);
    b2.state = 'idle';
    stepSim(s2, DT, NO_INPUT);
    expect(b2.state).toBe('fight');
    for (const i of b2.cells) {
      if (b2.gates.includes(i)) continue;
      expect(s2.tiles[i]).toBe(tiles0[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Монстры.
// ---------------------------------------------------------------------------

const cellsWith = (mark: number, area?: string) => {
  const out: number[] = [];
  for (let i = 0; i < world.mark.length; i++)
    if (world.mark[i] === mark && (!area || world.rowArea[Math.floor(i / W)] === area)) out.push(i);
  return out;
};

/** Клетка пола в n клетках от точки, с прямой видимостью по полу. */
function floorNear(s: Sim, x: number, y: number, n: number): [number, number] {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const px = x + Math.cos(a) * n;
    const py = y + Math.sin(a) * n;
    let ok = true;
    for (let t = 0.1; t <= 1; t += 0.05) if (solidAt(s, x + (px - x) * t, y + (py - y) * t)) ok = false;
    if (ok) return [px, py];
  }
  throw new Error('нет пола рядом');
}

describe('этаж 10: монстры', () => {
  it('горгулья на постаменте — камень: удар не берёт, оживает, когда подходишь', () => {
    const plinth = cellsWith(F10_MARK.plinth, F10_GALLERY)[0];
    const px = (plinth % W) + 0.5;
    const py = Math.floor(plinth / W) + 0.5;
    // Пост встаёт, когда герой в 5–16 клетках.
    const s = sim(8, 5, px, py + 6, 3);
    let g: Mob | undefined;
    for (let t = 0; t < 30 && !g; t++) {
      stepSim(s, DT, NO_INPUT);
      g = s.mobs.find((m) => m.kind === 'f10_gargoyle' && Math.hypot(m.x - px, m.y - py) < 0.2);
    }
    expect(g).toBeDefined();
    expect(g!.mode).toBe('f10_stone');
    expect(g!.data.ghost).toBe(1);
    // Подошёл на 3,5 клетки и бьёт воздух — камень молчит.
    s.hero.y = py + 3.5;
    const hp0 = g!.hp;
    for (let t = 0; t < 2 * 60; t++) stepSim(s, DT, { ...NO_INPUT, attack: t % 10 === 0, aim: { x: 0, y: -1 } });
    expect(g!.mode).toBe('f10_stone');
    expect(g!.hp).toBe(hp0);
    expect(g!.x).toBeCloseTo(px, 5);
    // Подошёл вплотную — ожила: сперва трескается (метка), потом открыта.
    s.hero.y = py + 2;
    let woke = false;
    let open = false;
    for (let t = 0; t < 2 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      if (g!.mode === 'f10_wake') woke = true;
      if (woke && g!.mode !== 'f10_wake' && g!.data.ghost === 0) open = true;
    }
    expect(woke).toBe(true);
    expect(open).toBe(true);
  });

  it('рыцарь ада на скаку не тормозит у края: пропускаешь — он в бездне', () => {
    // Изгиб моста: рыцарь с юга скачет на север, за мостом — пропасть.
    const [bx, by] = at(F10_GATES, 31, 60);
    const s = sim(8, 5, bx + 3.5, by - 6, 4);
    s.mobs = [];
    const k = spawnMob(s, 'f10_knight', bx + 0.5, by + 0.5, { mode: 'chase' });
    // Герой стоит на изгибе прямо по ходу; в последний миг — в сторону.
    s.hero.x = bx + 0.5;
    s.hero.y = by - 8 + 0.5;
    let fell = false;
    let dodge = false;
    for (let t = 0; t < 8 * 60 && !fell; t++) {
      s.hero.hp = s.stats.maxHp;
      const inp = { ...NO_INPUT };
      if (k.mode === 'aim' && k.danger > 0) dodge = true;
      if (dodge && s.hero.x < bx + 4) {
        inp.mx = 1;
        inp.dash = s.hero.dashCd <= 0;
      }
      stepSim(s, DT, inp);
      if (s.events.some((e) => e.t === 'boss' && e.what === 'f10_fall')) fell = true;
    }
    expect(fell).toBe(true);
    for (let t = 0; t < 90; t++) stepSim(s, DT, NO_INPUT);
    expect(s.mobs.includes(k) && k.mode !== 'escape' && k.hp > 0).toBe(false);
    expect(KNIGHT.speed).toBeGreaterThan(10);
  });

  it('рыцарь о стену — оглушён и открыт', () => {
    const [x, y] = at(F10_THRONE, 31, 60);
    const s = sim(8, 5, x + 0.5, y + 0.5, 5);
    s.mobs = [];
    const k = spawnMob(s, 'f10_knight', x + 0.5, y + 0.5, { mode: 'charge' });
    k.dir = Math.PI; // на запад, в стену шествия
    k.data.run = 0;
    k.bounce = true;
    s.hero.x = x + 0.5;
    s.hero.y = y + 6;
    let dizzy = false;
    for (let t = 0; t < 2 * 60 && !dizzy; t++) {
      stepSim(s, DT, NO_INPUT);
      if (k.mode === 'dizzy') dizzy = true;
    }
    expect(dizzy).toBe(true);
  });

  it('поцелуй суккубы очаровывает не дольше полутора секунд', () => {
    const [x, y] = at(F10_GALLERY, 16, 44);
    const s = sim(8, 5, x + 0.5, y + 0.5, 6);
    s.mobs = [];
    const [sx, sy] = floorNear(s, x + 0.5, y + 0.5, 4);
    spawnMob(s, 'f10_succubus', sx, sy, { mode: 'chase' });
    let charmed = 0;
    let maxT = 0;
    let longest = 0;
    let run = 0;
    for (let t = 0; t < 20 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      const c = s.hero.status.charm?.t ?? 0;
      maxT = Math.max(maxT, c);
      if (c > 0) {
        run += DT;
        longest = Math.max(longest, run);
      } else if (run > 0) {
        charmed += 1;
        run = 0;
      }
    }
    expect(charmed).toBeGreaterThan(0);
    expect(maxT).toBeLessThanOrEqual(1.5);
    // Даже подряд (сердце за сердцем) — не вечное очарование.
    expect(longest).toBeLessThan(3.2);
  });

  it('псы на цепях у столбов псарни не уходят дальше цепи', () => {
    const post = world.objs.find((o) => o.kind === 'deco' && o.ref === 'f10_post')!;
    const s = sim(8, 5, post.x + 0.5, post.y + 7.5, 7);
    let hounds: Mob[] = [];
    let maxOut = 0;
    for (let t = 0; t < 15 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      // Дразнит: ходит туда-сюда в шести-семи клетках.
      stepSim(s, DT, { ...NO_INPUT, mx: Math.sin(t / 90), my: 0 });
      hounds = s.mobs.filter((m) => m.kind === 'f10_hound' && m.data.chain);
      for (const m of hounds)
        maxOut = Math.max(maxOut, Math.hypot(m.x - m.data.px, m.y - m.data.py) - m.data.len);
    }
    expect(hounds.length).toBeGreaterThanOrEqual(2);
    expect(maxOut).toBeLessThan(0.05);
    expect(s.zones.some((z) => z.art === 'f10_chain')).toBe(true);
  });

  it('стражи на постах стоят, пока не увидят; палач бьёт кругом цепа с окном внутри', () => {
    const s = sim(8, 5, 1, 1, 8);
    stepSim(s, DT, NO_INPUT);
    const posts = f10Posts(s);
    const kinds = new Set(posts.map((p) => p.kind));
    for (const k of ['f10_guard', 'f10_exec', 'f10_gargoyle', 'f10_knight', 'f10_hound']) expect(kinds.has(k)).toBe(true);
    // Палач: кольцо цепа не задевает стоящего вплотную.
    const [x, y] = at(F10_GATES, 12, 56);
    const s2 = sim(8, 5, x + 0.5, y + 0.5, 9);
    s2.mobs = [];
    const e = spawnMob(s2, 'f10_exec', x + 0.5, y - 1.5, { mode: 'chase' });
    let ring = false;
    for (let t = 0; t < 12 * 60 && !ring; t++) {
      s2.hero.hp = s2.stats.maxHp;
      stepSim(s2, DT, NO_INPUT);
      const z = s2.strikes.find((q) => q.art === 'f10_flail');
      if (z) {
        ring = true;
        expect(z.shape).toBe('ring');
        expect(strikeHits(z, z.x, z.y, 0.3)).toBe(false);
      }
    }
    expect(ring || e.mode === 'dying').toBe(true);
  });

  it('монстры этажа не застревают в стенах и не падают в бездну сами', () => {
    const kinds = ['f10_hound', 'f10_guard', 'f10_knight', 'f10_succubus', 'f10_mage', 'f10_exec', 'f10_imp'];
    const spots = [
      at(F10_GATES, 31, 64),
      at(F10_GATES, 36, 51),
      at(F10_GATES, 12, 44),
      at(F10_GALLERY, 31, 66),
      at(F10_GALLERY, 14, 40),
      at(F10_THRONE, 31, 60),
    ];
    let stuck = 0;
    let checks = 0;
    let lost = 0;
    for (let k = 0; k < spots.length; k++) {
      const [x0, y0] = spots[k];
      const x = x0 + 0.5;
      const y = y0 + 0.5;
      const s = sim(8, 5, x, y, 60 + k, 6);
      s.hero.inv = 3;
      expect(solidAt(s, x, y)).toBe(false);
      for (let j = 0; j < 5; j++) {
        const kind = kinds[(k + j) % kinds.length];
        const [mx, my] = floorNear(s, x, y, 2 + (j % 3));
        spawnMob(s, kind, mx, my, { mode: 'chase' });
      }
      const st: BotState = { lastAtk: -9, react: [0.25, 0.4], miss: 0.1, seed: k + 1 };
      for (let t = 0; t < 30 * 60; t++) {
        stepSim(s, DT, bot(s, st));
        if (t % 10) continue;
        for (const m of s.mobs) {
          if (['dying', 'emerge', 'escape', 'f10_fall', 'f10_puff'].includes(m.mode) || m.t < 0) continue;
          if (m.kind === 'f10_succubus' || (m.data.ghost ?? 0) > 0) continue;
          checks += 1;
          const tl = s.tiles[Math.floor(m.y) * W + Math.floor(m.x)];
          if (tl === Tile.Deep) {
            lost += 1;
            if (LOG) console.log('в бездне', m.kind, m.mode, m.x.toFixed(2), m.y.toFixed(2), m.t.toFixed(2));
          }
          else if (solidAt(s, m.x, m.y)) stuck += 1;
        }
        if (s.hero.mode === 'dead') break;
      }
    }
    expect(checks).toBeGreaterThan(400);
    expect(stuck).toBe(0);
    expect(lost).toBe(0);
  });

  it('у каждого удара монстров есть метка и опасность до удара', () => {
    // Все метки этажа горят хотя бы полсекунды — окно, чтобы уйти.
    const arts = new Map<string, number>();
    const [x, y] = at(F10_GALLERY, 31, 66);
    const s = sim(8, 5, x + 0.5, y + 0.5, 12);
    s.mobs = [];
    for (const [j, kind] of ['f10_guard', 'f10_mage', 'f10_exec', 'f10_gargoyle', 'f10_hound'].entries()) {
      const [mx, my] = floorNear(s, x + 0.5, y + 0.5, 2.5 + (j % 2));
      spawnMob(s, kind, mx, my, { mode: 'chase' });
    }
    for (let t = 0; t < 25 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      for (const z of s.strikes) if (z.art && !arts.has(z.art)) arts.set(z.art, z.warn);
    }
    expect(arts.size).toBeGreaterThanOrEqual(4);
    for (const [art, warn] of arts) expect(warn, art).toBeGreaterThanOrEqual(0.4);
  });
});

// ---------------------------------------------------------------------------
// Районы: шипы Врат, мост, гроза, сокровищница.
// ---------------------------------------------------------------------------

describe('этаж 10: районы', () => {
  it('шипы Врат бьют волной по рядам: метка за 0,6 с, ряды не разом', () => {
    const rows = [...new Set(cellsWith(F10_MARK.spike).map((i) => Math.floor(i / W)))].sort((a, b) => b - a);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const cx = cellsWith(F10_MARK.spike)[0] % W;
    const s = sim(8, 5, cx + 0.5, rows[0] + 2.5, 13);
    s.mobs = [];
    const first = new Map<number, number>();
    for (let t = 0; t < 4 * 60; t++) {
      stepSim(s, DT, NO_INPUT);
      for (const z of s.strikes)
        if (z.art === 'f10_spikewarn' && !first.has(Math.floor(z.y))) {
          first.set(Math.floor(z.y), s.time);
          expect(z.warn).toBeGreaterThanOrEqual(0.55);
        }
    }
    expect(first.size).toBe(rows.length);
    const times = rows.map((r) => first.get(r)!);
    expect(new Set(times.map((v) => v.toFixed(2))).size).toBe(rows.length);
  });

  it('мост рушится за спиной, с того берега — рыцари; убил — доски возвращаются', () => {
    const s = sim(8, 5, 1, 1, 14);
    stepSim(s, DT, NO_INPUT);
    const ev = f10Events(s)!;
    expect(ev.fragile.length).toBeGreaterThanOrEqual(16);
    const ys = ev.fragile.map((i) => Math.floor(i / W));
    const x = (ev.fragile[0] % W) + 0.5;
    const yBot = Math.max(...ys) + 2.5;
    const yTop = Math.min(...ys) - 3.5;
    s.hero.x = x;
    s.hero.y = yBot;
    s.mobs = [];
    let crack = false;
    for (let t = 0; t < 10 * 60 && s.hero.y > yTop; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, { ...NO_INPUT, my: -1 });
      if (f10Events(s)!.bridge === 'crack') crack = true;
    }
    expect(crack).toBe(true);
    for (let t = 0; t < 3 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
    }
    expect(f10Events(s)!.bridge).toBe('fallen');
    expect(ev.fragile.every((i) => s.tiles[i] === Tile.Deep)).toBe(true);
    const knights = s.mobs.filter((m) => m.kind === 'f10_knight');
    expect(knights.length).toBeGreaterThanOrEqual(1);
    for (const k of knights) API.setMode(k, 'dying');
    s.mobs = s.mobs.filter((m) => m.kind !== 'f10_knight');
    for (let t = 0; t < 5 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
    }
    expect(f10Events(s)!.bridge).toBe('done');
    expect(ev.fragile.every((i) => walkableTile(s.tiles[i]))).toBe(true);
  });

  it('гроза Витражного зала: у каждой волны есть безопасные клетки, потом витражи выбиты и добыча', () => {
    const s = sim(8, 5, 1, 1, 15);
    stepSim(s, DT, NO_INPUT);
    const [x0, y0, x1, y1] = f10Events(s)!.stormBox;
    expect(x1 - x0).toBeGreaterThan(10);
    s.hero.x = (x0 + x1) / 2 + 0.5;
    s.hero.y = y1 - 4.5;
    s.mobs = [];
    let waves = 0;
    let seen = new Set<number>();
    for (let t = 0; t < 25 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      s.hero.inv = 1;
      stepSim(s, DT, NO_INPUT);
      const fresh = s.strikes.filter((z) => z.art?.startsWith('f10_bolt') && !seen.has(z.id));
      if (fresh.length) {
        waves += 1;
        for (const z of fresh) seen.add(z.id);
        // Хоть одна клетка зала этой волной не задета.
        let safe = 0;
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++)
            if (!s.strikes.some((z) => z.art?.startsWith('f10_bolt') && z.t < 0.05 && strikeHits(z, x + 0.5, y + 0.5, 0.35)))
              safe += 1;
        expect(safe).toBeGreaterThan(8);
      }
      if (f10Events(s)!.storm === 'rest') break;
    }
    expect(waves).toBeGreaterThanOrEqual(8);
    expect(f10Events(s)!.storm).toBe('rest');
    expect(s.drops.some((d) => d.kind === 'f10_sigil')).toBe(true);
    seen = new Set();
  });

  it('сокровищница: открыл тайник — решётка падает, горгульи оживают; перебил — решётка поднимается', () => {
    const s = sim(8, 5, 1, 1, 16);
    stepSim(s, DT, NO_INPUT);
    const ev = f10Events(s)!;
    expect(ev.vaultDoor.length).toBeGreaterThan(0);
    const chest = s.props.find((p) => p.kind === 'secret' && world.rowArea[Math.floor(p.y)] === F10_THRONE)!;
    s.hero.x = chest.x;
    s.hero.y = chest.y + 1.5;
    s.mobs = [];
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    const gargs = () => s.mobs.filter((m) => m.kind === 'f10_gargoyle');
    expect(gargs().length).toBeGreaterThanOrEqual(2);
    expect(gargs().every((m) => m.mode === 'f10_stone')).toBe(true);
    chest.on = true;
    for (let t = 0; t < 3 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
    }
    expect(f10Events(s)!.vault).toBe('shut');
    for (const i of ev.vaultDoor) expect(walkableTile(s.tiles[i])).toBe(false);
    expect(gargs().every((m) => m.mode !== 'f10_stone')).toBe(true);
    for (const m of gargs()) m.hp = 1;
    for (let t = 0; t < 10 * 60 && gargs().length; t++) {
      s.hero.hp = s.stats.maxHp;
      const g = gargs().find((m) => m.mode !== 'dying' && !(m.data.ghost ?? 0));
      const inp = { ...NO_INPUT };
      if (g) {
        const d = Math.hypot(g.x - s.hero.x, g.y - s.hero.y);
        inp.mx = (g.x - s.hero.x) / d;
        inp.my = (g.y - s.hero.y) / d;
        inp.attack = t % 8 === 0;
        inp.aim = { x: inp.mx, y: inp.my };
      }
      stepSim(s, DT, inp);
    }
    for (let t = 0; t < 60; t++) stepSim(s, DT, NO_INPUT);
    expect(f10Events(s)!.vault).toBe('done');
    for (const i of ev.vaultDoor) expect(walkableTile(s.tiles[i])).toBe(true);
  });

  it('этаж проходим: от лифта Врат через Галерею до ворот тронного зала на Т8+5 с едой', () => {
    const lift = world.objs.find((o) => o.kind === 'lift' && o.area === F10_GATES)!;
    const probe = sim(8, 5, 1, 1, 1);
    const gate = probe.boss!.gates[1] ?? probe.boss!.gates[0];
    const gx = gate % W;
    const gy = Math.floor(gate / W) + 3;
    const goal = field(gx, gy);
    let arrived = 0;
    for (const seed of [71, 72, 73]) {
      const s = sim(8, 5, lift.x + 0.5, lift.y + 1.5, seed, 10);
      const st: BotState = { lastAtk: -9, react: [0.22, 0.4], miss: 0.1, seed };
      let t = 0;
      let stuckT = 0;
      let lastD = 1e9;
      for (; t < 600 * 60; t++) {
        const inp = bot(s, st);
        // Никого рядом и никаких меток — идти к цели.
        if (!inp.mx && !inp.my && !inp.attack && !inp.eat) Object.assign(inp, follow(s, goal, gx, gy), { dash: false });
        stepSim(s, DT, inp);
        if (Math.hypot(s.hero.x - gx - 0.5, s.hero.y - gy - 0.5) < 1.5) break;
        if (s.hero.mode === 'dead') break;
        if (t % 600 === 0) {
          const d = goal[Math.floor(s.hero.y) * W + Math.floor(s.hero.x)];
          stuckT = d >= lastD ? stuckT + 10 : 0;
          lastD = Math.min(lastD, d);
        }
      }
      if (LOG)
        console.log(
          `путь ${seed}: ${s.hero.mode === 'dead' ? 'погиб' : t < 600 * 60 ? `${(t / 60).toFixed(0)} с` : 'не дошёл'}, убито ${s.killed}, где ${s.area} ${s.hero.x.toFixed(0)},${(s.hero.y - band(s.area).top).toFixed(0)}, мост ${f10Events(s)?.bridge}`,
        );
      if (s.hero.mode !== 'dead' && t < 600 * 60) arrived += 1;
    }
    expect(arrived).toBeGreaterThanOrEqual(2);
  });
});
