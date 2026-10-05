// Этаж 13 «Театр марионеток»: бой с Кукловодом ботом, дорога к арене,
// выход после победы, посты, механики этажа (нити, люки, свет, маски,
// смена декораций, пожарный занавес, действия).
//
// Подробный журнал боя: `F13LOG=1 npx vitest run src/lib/dungeon-floors/f13.test.ts`.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { FLOOR_SCRIPTS } from '../dungeon-ai';
import { buildWorld, Tile, walkableTile } from '../dungeon-world';
import { API, createSim, NO_INPUT, spawnMob, stepSim, strikeHits, SWORD } from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import {
  BOSS,
  F13_FX,
  F13_SCENERY,
  f13Boss,
  f13State,
  inBeam,
  STR,
  stringsOf,
} from './f13-brains';
import { F13_FLIES, F13_FOYER, F13_GEO, F13_HALL, F13_TOP } from './f13';

const world = buildWorld(13);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F13LOG;

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 13 };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7, meat = 0): Sim {
  const d = dungeon(tier, plus);
  const s = createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
  if (meat) {
    s.sack.meat.f13_candy = meat;
    s.sack.meatBy[F13_FOYER] = meat;
  }
  return s;
}

const gw = (area: string, x: number, y: number): [number, number] => [x, y + F13_TOP[area]];

function run(s: Sim, secs: number, inp: SimInput | ((s: Sim) => SimInput) = NO_INPUT): void {
  for (let t = 0; t < secs * 60; t++) stepSim(s, DT, typeof inp === 'function' ? inp(s) : inp);
}

function runEv(s: Sim, secs: number, inp: SimInput | ((s: Sim) => SimInput) = NO_INPUT): Set<string> {
  const out = new Set<string>();
  for (let t = 0; t < secs * 60; t++) {
    stepSim(s, DT, typeof inp === 'function' ? inp(s) : inp);
    for (const e of s.events) if (e.t === 'boss') out.add(e.what);
      else out.add(e.t);
  }
  return out;
}

const still = (s: Sim) => {
  s.hero.hp = s.stats.maxHp;
  return NO_INPUT;
};

// ---------------------------------------------------------------------------
// Бот боя.
// ---------------------------------------------------------------------------

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

const bossObj = world.objs.find((o) => o.kind === 'boss')!;

function swingAt(s: Sim, st: BotState, inp: SimInput, x: number, y: number): void {
  const h = s.hero;
  if (s.time - st.lastAtk > 0.14) {
    inp.attack = true;
    inp.aim = { x: x - h.x, y: y - h.y };
    st.lastAtk = s.time;
  }
}

function bot(s: Sim, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  const bs = f13Boss(s);
  // Волны «Бури»: гребень рядом и ты не в проёме — рывок сквозь него.
  for (const w of F13_FX.waves) {
    if (w.t < BOSS.wave.swell) continue;
    const ahead = (h.y - w.y) * w.dir;
    if (ahead < -0.2 || ahead > 1.4) continue;
    if (w.gaps.some((g) => Math.abs(h.x - g) < BOSS.wave.gapW / 2 - 0.4)) continue;
    const [, missed] = notice(st, `wv${w.t < 2 ? 0 : 1}:${w.gaps[0].toFixed(2)}`);
    if (missed) continue;
    if (ahead < 0.9 && h.dashCd <= 0) {
      inp.mx = 0;
      inp.my = -w.dir;
      inp.dash = true;
      return inp;
    }
    const g = w.gaps.reduce((a, c) => (Math.abs(c - h.x) < Math.abs(a - h.x) ? c : a));
    if (Math.abs(g - h.x) < 3) {
      inp.mx = Math.sign(g - h.x);
      return inp;
    }
  }
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
      const d = Math.hypot(ax, ay) || 1;
      if (d < z.r && z.r - (z.w ?? 0) > 2) {
        ax = -ax;
        ay = -ay;
      }
    }
    const l = Math.hypot(ax, ay) || 1;
    inp.mx = ax / l;
    inp.my = ay / l;
    if (left < 0.22 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Метки мобов: линия, конус, круг — вбок или прочь.
  for (const m of s.mobs) {
    const t = m.tele;
    if (!t) continue;
    const [react, missed] = notice(st, `t${m.id}:${m.mode}:${Math.round((s.time - m.t) * 10)}`);
    if (missed || m.t < react) continue;
    const ox = t.x ?? m.x;
    const oy = t.y ?? m.y;
    const hit = strikeHits(
      { shape: t.shape, x: ox, y: oy, r: t.r, w: t.w, ang: t.ang, arc: t.arc, warn: 1, dmg: 0 },
      h.x,
      h.y,
      h.r + 0.3,
    );
    if (!hit) continue;
    let ax = h.x - ox;
    let ay = h.y - oy;
    if (t.shape === 'line') {
      const a = (t.ang ?? 0) + Math.PI / 2;
      const side = Math.cos(a) * ax + Math.sin(a) * ay >= 0 ? 1 : -1;
      ax = Math.cos(a) * side;
      ay = Math.sin(a) * side;
    }
    const l = Math.hypot(ax, ay) || 1;
    inp.mx = ax / l;
    inp.my = ay / l;
    if (m.danger > 0 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Замах вплотную — отскок.
  for (const m of s.mobs) {
    if (m.mode !== 'windup') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const [react, missed] = notice(st, `w${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (!missed && m.t > react && d < (MOBS[m.kind]?.reach ?? 1) + m.r + 0.9 && h.dashCd <= 0) {
      const away = Math.atan2(h.y - m.y, h.x - m.x) + 0.9;
      inp.mx = Math.cos(away);
      inp.my = Math.sin(away);
      inp.dash = true;
      return inp;
    }
  }
  // Звёзды-маятники: близко — в сторону.
  for (const t of F13_FX.stars) {
    if (t.cut) continue;
    const d = Math.hypot(t.x - h.x, t.y - h.y);
    if (d < 1.9) {
      inp.mx = (h.x - t.x) / d;
      inp.my = (h.y - t.y) / d;
      return inp;
    }
  }
  const meat = Object.values(s.sack.meat).reduce<number>((a, c) => a + (c ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) inp.eat = true;

  const lord = s.mobs.find((m) => m.kind === 'f13boss' && m.mode !== 'dying');
  const go = (x: number, y: number, near: number) => {
    const d = Math.hypot(x - h.x, y - h.y);
    if (d > near) {
      inp.mx = (x - h.x) / d;
      inp.my = (y - h.y) / d;
    }
    return d;
  };
  // Кукловод открыт — бить его.
  if (lord && !(lord.data.ghost ?? 0) && (lord.data.open || bs?.act === 3 || s.time < (bs?.dipUntil ?? 0))) {
    const d = go(lord.x, lord.y, SWORD.reach * 0.8 + lord.r * 0.5);
    if (d < SWORD.reach + lord.r) swingAt(s, st, inp, lord.x, lord.y);
    return inp;
  }
  // Нити исполина и звёзд — резать.
  if (bs && bs.trans <= 0) {
    if (bs.act === 0) {
      const g = s.mobs.find((m) => m.kind === 'f13_giant' && m.mode !== 'f13_slump' && m.mode !== 'f13_rebuild');
      const seg = g ? stringsOf(g).find((q) => !q.cut) : null;
      if (seg) {
        const px = seg.ax + (seg.bx - seg.ax) * 0.55;
        const py = seg.ay + (seg.by - seg.ay) * 0.55;
        const d = go(px + 0.7, py, 0.6);
        if (d < SWORD.reach) swingAt(s, st, inp, px, py);
        return inp;
      }
    }
    if (bs.act === 2) {
      const t = bs.stars.find((q) => !q.cut);
      if (t) {
        const px = t.px + (t.x - t.px) * 0.4;
        const py = t.py + (t.y - t.py) * 0.4;
        const d = go(t.px, t.py + 3.6, 0.5);
        if (Math.hypot(px - h.x, py - h.y) < SWORD.reach || d < 0.8) swingAt(s, st, inp, px, py);
        return inp;
      }
    }
  }
  // Иначе — ближний враг (кукла на нитях — сбоку, по нитям).
  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || (m.data.ghost ?? 0) > 0 || m.kind === 'f13boss' || m.kind === 'f13_giant') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near && nd < 12) {
    const d = go(near.x, near.y, SWORD.reach * 0.8 + near.r * 0.5);
    if (d < SWORD.reach + near.r) swingAt(s, st, inp, near.x, near.y);
  } else if (lord) go(lord.x, lord.y + 3, 1.5);
  return inp;
}

interface Fight {
  won: number;
  s: Sim;
  acts: number;
  low: number;
  deaths: number;
}

function fight(tier: number, plus: number, seed: number, meat = 4): Fight {
  const s = sim(tier, plus, bossObj.x + 0.5, bossObj.y + 7.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.22, 0.45], miss: 0.12, seed };
  let won = -1;
  let acts = 0;
  let low = 1;
  let eaten = 0;
  const modes = new Map<string, number>();
  let lordK = 1;
  for (let t = 0; t < 480 * 60; t++) {
    stepSim(s, DT, bot(s, st));
    low = Math.min(low, s.hero.hp / s.stats.maxHp);
    const k = s.mobs.find((m) => m.kind === 'f13boss');
    if (k) {
      modes.set(`${f13Boss(s)?.act}:${k.mode}`, (modes.get(`${f13Boss(s)?.act}:${k.mode}`) ?? 0) + DT);
      lordK = k.hp / k.maxHp;
      if (process.env.F13TRACE && t % 600 === 0)
        console.log(
          `  ${s.time.toFixed(0)} с акт ${f13Boss(s)?.act} герой ${s.hero.x.toFixed(1)},${s.hero.y.toFixed(1)} ${Math.round((100 * s.hero.hp) / s.stats.maxHp)}% · K ${k.x.toFixed(1)},${k.y.toFixed(1)} ${k.mode} open ${k.data.open ?? 0} ghost ${k.data.ghost ?? 0} ${Math.round((100 * k.hp) / k.maxHp)}% · мобов ${s.mobs.length}`,
        );
    }
    acts = Math.max(acts, f13Boss(s)?.act ?? 0);
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'eat') eaten += 1;
    }
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  if (LOG)
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, акт ${acts + 1}, Кукловод ${Math.round(100 * lordK)}%, минимум здоровья ${Math.round(low * 100)}%, съел ${eaten}\n  режимы: ${[...modes].map(([m, v]) => `${m}:${v.toFixed(0)}`).join(' ')}`,
    );
  return { won, s, acts, low, deaths: s.hero.mode === 'dead' ? 1 : 0 };
}

describe('этаж 13: Кукловод', () => {
  it('на Т8+5 с едой бот побеждает за 2–6 минут, проходя все четыре акта', () => {
    const res = [41, 42, 43, 44].map((seed) => fight(8, 5, seed));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(120);
      expect(r.won).toBeLessThan(360);
      expect(r.acts).toBe(3);
    }
    expect(res.some((r) => r.won < 0 || r.low < 0.45)).toBe(true);
  });

  it('на Т8+0 без еды — смерть чаще победы', () => {
    const res = [51, 52, 53].map((seed) => fight(8, 0, seed, 0).won);
    expect(res.filter((t) => t > 0).length).toBeLessThanOrEqual(1);
  });
});

describe.runIf(!!process.env.F13SWEEP)('этаж 13: подбор', () => {
  it('сетка снаряжения', () => {
    for (const [tier, plus, meat] of (process.env.F13SWEEP ?? '')
      .split(';')
      .map((x) => x.split(',').map(Number)))
      for (const seed of [61, 62, 63]) fight(tier, plus, seed, meat);
  });
});

// ---------------------------------------------------------------------------
// Арена и дорога к ней.
// ---------------------------------------------------------------------------

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

describe('этаж 13: сцена и дорога', () => {
  it('после победы со сцены выходят, ворота не захлопываются на герое', () => {
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

  it('от лифта до ворот арены — дорога есть, живой бот доходит; в Предбаннике — свой лифт', () => {
    const entry = world.objs.find((o) => o.kind === 'lift' && o.area === F13_FOYER)!;
    const upper = world.objs.find((o) => o.kind === 'lift' && o.area === F13_FLIES)!;
    expect(entry).toBeTruthy();
    expect(upper).toBeTruthy();
    const probe = sim(8, 5, entry.x + 0.5, entry.y + 1.5, 3);
    const gate = probe.boss!.gates[0];
    const f = field(gate % W, Math.floor(gate / W));
    for (const l of [entry, upper]) expect(f[(l.y + 1) * W + l.x]).toBeGreaterThan(0);
    // По живому миру от входа: без мобов, но с люками, софитами, сменой
    // декораций и пожарным занавесом.
    const s = sim(8, 5, entry.x + 0.5, entry.y + 1.5, 3);
    const tiles = Uint8Array.from(world.tiles);
    for (const p of s.props)
      if (p.alive && p.r >= 0.3) tiles[Math.floor(p.y) * W + Math.floor(p.x)] = Tile.Wall;
    const fl = field(gate % W, Math.floor(gate / W), tiles);
    const h = s.hero;
    let arrived = -1;
    for (let t = 0; t < 600 * 60; t++) {
      s.mobs = [];
      h.hp = s.stats.maxHp;
      stepSim(s, DT, follow(s, fl, gate % W, Math.floor(gate / W)));
      if (Math.hypot((gate % W) + 0.5 - h.x, Math.floor(gate / W) + 0.5 - h.y) < 1.2) {
        arrived = s.time;
        break;
      }
    }
    if (LOG) console.log(`от лифта до ворот: ${arrived.toFixed(0)} с; стоит ${h.x.toFixed(1)},${h.y.toFixed(1)}`);
    expect(arrived).toBeGreaterThan(0);
  });

  it('посты на проходимых клетках; декорации круга и ряды занавеса — на полу', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 7.5, 2);
    stepSim(s, DT, NO_INPUT);
    const st = f13State(s)!;
    expect(st.posts.length).toBeGreaterThan(30);
    for (const p of st.posts) expect(walkableTile(world.tiles[Math.floor(p.y) * W + Math.floor(p.x)])).toBe(true);
    expect(st.traps.length).toBe(11);
    expect(st.spots.length).toBe(7);
    expect(st.chands.length).toBeGreaterThan(10);
    for (const r of st.iron.rows) expect(r.cells.length).toBeGreaterThan(6);
    for (const L of F13_SCENERY) {
      expect(L.cells.length, L.name).toBeGreaterThan(20);
      for (const [x, y] of L.cells) expect(world.tiles[y * W + x]).toBe(Tile.Floor);
    }
  });
});

// ---------------------------------------------------------------------------
// Механики.
// ---------------------------------------------------------------------------

/** Пустой зал Фойе у лифта: герой и кукла, больше никого. */
function lab(kind: string, dx: number, dy: number, seed = 5): { s: Sim; m: Mob } {
  const [x, y] = gw(F13_FOYER, 31.5, 99.5);
  const s = sim(8, 5, x, y, seed);
  stepSim(s, DT, NO_INPUT);
  s.mobs = [];
  for (const p of f13State(s)!.posts) p.dead = true;
  const m = spawnMob(s, kind, x + dx, y + dy, { mode: 'chase' });
  return { s, m };
}

describe('этаж 13: нити', () => {
  it('взмах по нити сбоку режет её; все нити — рыцарь ползёт, скрипач рассыпается', () => {
    const { s, m } = lab('f13_knight', 1.4, -1.2);
    stepSim(s, DT, NO_INPUT);
    expect(m.data.sn).toBe(2);
    // Бьём вверх-вправо, в нити над куклой.
    for (let i = 0; i < 40 && (m.data.cut ?? 0) !== 3; i++) {
      m.x = s.hero.x + 1.2;
      m.y = s.hero.y + 0.8;
      m.vx = m.vy = 0;
      const seg = stringsOf(m).find((q) => !q.cut)!;
      run(s, 0.3, () => ({ ...NO_INPUT, attack: true, aim: { x: seg.ax - s.hero.x, y: seg.ay - 0.8 - s.hero.y } }));
      s.hero.hp = s.stats.maxHp;
      m.hp = m.maxHp;
    }
    expect(m.data.cut).toBe(3);
    expect(m.data.crawl).toBe(1);
    const f = lab('f13_fiddler', 1.2, 0.8, 6);
    stepSim(f.s, DT, NO_INPUT);
    const seg = stringsOf(f.m)[0];
    const ev = runEv(f.s, 0.4, () => ({ ...NO_INPUT, attack: true, aim: { x: seg.ax - f.s.hero.x, y: seg.ay - 0.8 - f.s.hero.y } }));
    expect(ev.has('f13_snap_fall')).toBe(true);
    run(f.s, 0.2, still);
    expect(f.s.mobs.some((x) => x.id === f.m.id && x.mode !== 'dying')).toBe(false);
  });

  it('рывок поперёк нити режет её; удар снизу, с юга, до нитей не достаёт', () => {
    const { s, m } = lab('f13_knight', 0, -1.6);
    stepSim(s, DT, NO_INPUT);
    m.mode = 'f13_hush';
    const before = m.data.cut ?? 0;
    // Снизу — по кукле, нити целы.
    run(s, 0.6, () => {
      m.x = s.hero.x;
      m.y = s.hero.y - 1.05;
      return { ...NO_INPUT, attack: true, aim: { x: 0, y: -1 } };
    });
    expect(m.data.cut ?? 0).toBe(before);
    // Рывок поперёк — сквозь нити.
    const { s: s2, m: m2 } = lab('f13_knight', 1.6, -0.2, 9);
    stepSim(s2, DT, NO_INPUT);
    m2.mode = 'f13_hush';
    s2.hero.y = m2.y - 1.2;
    s2.hero.x = m2.x - 1.8;
    run(s2, 0.4, () => ({ ...NO_INPUT, mx: 1, my: 0, dash: true }));
    expect(m2.data.cut ?? 0).not.toBe(0);
  });

  it('мешок противовеса режет нити и давит', () => {
    const { s, m } = lab('f13_knight', 2, 0);
    stepSim(s, DT, NO_INPUT);
    const w = s.world.objs.find((o) => o.ref === 'f13_weight' && Math.hypot(o.x - m.x, o.y - m.y) < 12)!;
    expect(w).toBeTruthy();
    m.x = w.x + 1.5;
    m.y = w.y + 1.5;
    m.mode = 'f13_hush';
    const ok = FLOOR_SCRIPTS.get(13)!.onUse!(s, w, API);
    expect(ok).toBe(true);
    run(s, 0.8, still);
    expect(m.data.cut ?? 0).not.toBe(0);
    expect(m.hp).toBeLessThan(m.maxHp * 0.6);
  });
});

describe('этаж 13: сцена', () => {
  it('люк сцены открывается по такту: кукла на нём падает, героя ставит на край', () => {
    const g = F13_GEO.f13wall.stageTraps[0];
    const [tx, ty] = gw(F13_HALL, g[0][0] + 1, g[0][1] + 1);
    const s = sim(8, 5, tx - 3, ty, 4);
    stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    for (const p of f13State(s)!.posts) p.dead = true;
    const m = spawnMob(s, 'f13_knight', tx, ty, { mode: 'f13_hush' });
    f13State(s)!.hushUntil = 1e9;
    let fell = false;
    for (let t = 0; t < 12 * 60 && !fell; t++) {
      m.x = tx;
      m.y = ty;
      stepSim(s, DT, still(s));
      if (s.events.some((e) => e.t === 'fall')) fell = true;
    }
    expect(fell).toBe(true);
  });

  it('софиты: в луче мобы тебя видят, тень-актёр вне луча неуязвима', () => {
    const [bx, by] = gw(F13_HALL, 59.5, 40.5);
    const s = sim(8, 5, bx, by, 4);
    run(s, 1, still);
    const st = f13State(s)!;
    const boxes = st.spots.filter((q) => q.room === 'boxes');
    expect(boxes.every((q) => q.on)).toBe(true);
    const parterre = st.spots.filter((q) => q.room === 'parterre');
    expect(parterre.every((q) => !q.on)).toBe(true);
    // Тень у погашенного софита — призрак.
    s.mobs = [];
    const sh = spawnMob(s, 'f13_shade', bx, by, { mode: 'chase' });
    sh.data.beam = st.spots.indexOf(parterre[0]);
    run(s, 0.2, still);
    expect(sh.data.ghost).toBe(1);
    // Луч стоит на герое — свет.
    const sp = boxes[0];
    s.hero.x = sp.x;
    s.hero.y = sp.y;
    run(s, 0.05, still);
    expect(inBeam(s, s.hero.x, s.hero.y)).toBeGreaterThanOrEqual(0);
  });

  it('маски: «убитая» при живой паре трескается и встаёт; без пары — гибнут обе', () => {
    const { s, m } = lab('f13_comedy', 1, 0, 11);
    run(s, 0.1, still);
    const t = s.mobs.find((x) => x.kind === 'f13_tragedy')!;
    expect(t).toBeTruthy();
    expect(t.data.pair).toBe(m.id);
    m.hp = 1;
    const ev = runEv(s, 0.5, () => ({ ...still(s), attack: true, aim: { x: m.x - s.hero.x, y: m.y - s.hero.y } }));
    expect(m.mode === 'f13_broken' || ev.has('f13_crystal_stone')).toBe(true);
    run(s, 4.5, still);
    expect(m.mode).not.toBe('dying');
    expect(m.hp).toBeGreaterThan(m.maxHp * 0.3);
  });

  it('поворотный круг: звонок, линии, потом картон встаёт стеной; в конце всё убирают', () => {
    const [cx, cy] = [F13_GEO.f13bell.turn[0], F13_GEO.f13bell.turn[1] + F13_TOP[F13_FLIES]];
    const s = sim(8, 5, cx, cy + 2.5, 4);
    const ev = runEv(s, 3, (q) => {
      q.mobs = [];
      return still(q);
    });
    expect(ev.has('f13_bell_call')).toBe(true);
    const [x0, y0] = F13_SCENERY[0].cells[0];
    expect(s.tiles[y0 * W + x0]).toBe(Tile.Wall);
    run(s, 50, (q) => {
      q.mobs = [];
      return still(q);
    });
    expect(f13State(s)!.turn.state).toBe(2);
    for (const L of F13_SCENERY) for (const [x, y] of L.cells) expect(s.tiles[y * W + x]).toBe(Tile.Floor);
  });

  it('пожарный занавес: ряд горит секунду, потом стоит стеной; стопор клинит его', () => {
    const gal = F13_GEO.f13bell.gallery;
    const top = F13_TOP[F13_FLIES];
    const s = sim(8, 5, 31.5, gal[3] + top - 1.5, 4);
    run(s, 0.1, still);
    const st = f13State(s)!;
    expect(st.iron.state).toBe(1);
    let walled = false;
    for (let t = 0; t < 6 * 60 && !walled; t++) {
      s.mobs = [];
      stepSim(s, DT, still(s));
      walled = st.iron.rows.some((r) => s.tiles[r.cells[0]] === Tile.Wall);
    }
    expect(walled).toBe(true);
    const stop = s.world.objs.find((o) => o.ref === 'f13_stopper')!;
    s.hero.x = stop.x + 0.5;
    s.hero.y = stop.y + 1.5;
    expect(FLOOR_SCRIPTS.get(13)!.onUse!(s, stop, API)).toBe(true);
    expect(st.iron.rows.some((r) => r.jamUntil > s.time)).toBe(true);
  });
});

describe('этаж 13: Кукловод — акты', () => {
  it('нити исполина: все четыре срезаны — вага горит, Кукловод уязвим', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 7.5, 3);
    run(s, 3, still);
    const g = s.mobs.find((m) => m.kind === 'f13_giant')!;
    const lord = s.mobs.find((m) => m.kind === 'f13boss')!;
    expect(g).toBeTruthy();
    expect(lord.data.ghost).toBe(1);
    g.data.cut = 7;
    // Последнюю нить — взмахом.
    const seg = stringsOf(g)[3];
    s.hero.x = seg.ax + (seg.bx - seg.ax) * 0.5 + 0.8;
    s.hero.y = seg.ay + (seg.by - seg.ay) * 0.5;
    run(s, 0.3, () => ({
      ...still(s),
      attack: true,
      aim: { x: seg.ax + (seg.bx - seg.ax) * 0.5 - s.hero.x, y: seg.ay + (seg.by - seg.ay) * 0.5 - s.hero.y },
    }));
    expect(g.mode).toBe('f13_slump');
    run(s, 0.2, still);
    expect(lord.data.ghost).toBe(0);
    expect(lord.data.open).toBe(1);
    expect(STR.len).toBeGreaterThan(2);
  });

  it('засечка — занавес и смена акта: арена переписана, без исполина', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 7.5, 3);
    run(s, 3, still);
    const lord = s.mobs.find((m) => m.kind === 'f13boss')!;
    lord.hp = lord.maxHp * 0.74;
    const ev = runEv(s, BOSS.trans + 0.5, still);
    expect(ev.has('f13_bell_call')).toBe(true);
    expect(f13Boss(s)!.act).toBe(1);
    expect(s.mobs.some((m) => m.kind === 'f13_giant')).toBe(false);
    // Корабль стоит стеной.
    expect(s.tiles[11 * W + 31]).toBe(Tile.Wall);
  });
});
