// Этаж 11 «Небесный архипелаг»: бот против Древнего стража, выход с арены,
// обвал края и его откат, дорога от лифта до ворот, и глагол этажа — ветер:
// поток сносит, порыв сдувает с края (урон окружением и возврат на твёрдое),
// ветряки поворачивают мосты, лебёдка поднимает плиты, бегущий мост идёт
// волной, пилоны держат купол, робот, прижатый ветром к обрыву, падает.
//
// Бот — живой игрок средней руки: видит метки на полу и уходит из них
// рывком за миг до удара (с задержкой реакции и изредка проглядев), ест,
// когда здоровья меньше 40%, и держится против ветра у края. Против стража:
// под куполом бьёт пилоны, в остальное время — самого стража.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, Tile, walkableTile } from '../dungeon-world';
import { API, createSim, NO_INPUT, spawnMob, stepSim, strikeHits, SWORD } from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import { F11_DEBUG, f11State, windAt } from './f11-brains';
import { F11_AQUA, F11_CASTLE, F11_GARDEN, F11_MARK } from './f11';

const world = buildWorld(11);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F11LOG;

const band = (id: string) => world.bands.find((b) => b.def.id === id)!;
/** Мировая клетка по местным координатам района. */
const at = (area: string, x: number, y: number): [number, number] => [x, band(area).top + y];

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 11 };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7, meat = 0): Sim {
  const d = dungeon(tier, plus);
  const s = createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
  if (meat) {
    s.sack.meat.f11_fillet = meat;
    s.sack.meatBy[F11_CASTLE] = meat;
  }
  return s;
}

const standable = (s: Sim, x: number, y: number) => walkableTile(s.tiles[Math.floor(y) * W + Math.floor(x)]);

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

/** Клетка, куда можно уйти: пол, не трещина. */
const safeFloor = (s: Sim, x: number, y: number) => {
  const i = Math.floor(y) * W + Math.floor(x);
  if (!walkableTile(s.tiles[i])) return false;
  return s.world.mark[i] !== F11_MARK.cracking;
};

/** Не шагнуть туда, где за шагом — небо: повернуть вдоль края. */
function keepOn(s: Sim, inp: SimInput, reach = 1.2): void {
  const h = s.hero;
  if (!inp.mx && !inp.my) return;
  if (safeFloor(s, h.x + inp.mx * reach, h.y + inp.my * reach)) return;
  for (const a of [0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) {
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const mx = inp.mx * c - inp.my * sn;
    const my = inp.mx * sn + inp.my * c;
    if (safeFloor(s, h.x + mx * reach, h.y + my * reach)) {
      inp.mx = mx;
      inp.my = my;
      return;
    }
  }
}

function bot(s: Sim, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  const fst = f11State(s);
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
      if (d < z.r) {
        ax = -ax;
        ay = -ay;
      }
    }
    const l = Math.hypot(ax, ay) || 1;
    inp.mx = ax / l;
    inp.my = ay / l;
    if (!safeFloor(s, h.x + inp.mx * 2.2, h.y + inp.my * 2.2)) {
      inp.mx = -inp.my;
      inp.my = ax / l;
    }
    if (left < 0.22 && h.dashCd <= 0 && safeFloor(s, h.x + inp.mx * 2.4, h.y + inp.my * 2.4)) inp.dash = true;
    return inp;
  }
  // Линии прицела (взгляд стража, лазер, скат) — вбок.
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
    keepOn(s, inp);
    if (m.danger > 0 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Круговая метка у моба (удар кулаком, топот) — прочь.
  for (const m of s.mobs) {
    const t = m.tele;
    if (!t || t.shape === 'line') continue;
    const tx = t.x ?? m.x;
    const ty = t.y ?? m.y;
    const d = Math.hypot(h.x - tx, h.y - ty);
    if (d > t.r + h.r + 0.2) continue;
    const [react, missed] = notice(st, `c${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (missed || m.t < react) continue;
    inp.mx = (h.x - tx) / (d || 1);
    inp.my = (h.y - ty) / (d || 1);
    keepOn(s, inp, 2);
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
      keepOn(s, inp, 2.4);
      inp.dash = true;
      return inp;
    }
  }
  // Трещит под ногами или жжёт — отойти к середине арены.
  const here = Math.floor(h.y) * W + Math.floor(h.x);
  if (s.world.mark[here] === F11_MARK.cracking && fst) {
    const l = Math.hypot(fst.arena.cx - h.x, fst.arena.cy - h.y) || 1;
    inp.mx = (fst.arena.cx - h.x) / l;
    inp.my = (fst.arena.cy - h.y) / l;
    return inp;
  }
  for (const z of s.zones) {
    if (!z.dps || z.t < (z.warn ?? 0)) continue;
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d < z.r + h.r) {
      inp.mx = (h.x - z.x) / (d || 1);
      inp.my = (h.y - z.y) / (d || 1);
      keepOn(s, inp);
      return inp;
    }
  }
  const meat = Object.values(s.sack.meat).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) inp.eat = true;

  // Цель: под куполом — пилоны, иначе ближний враг (страж — тоже).
  let near: Mob | null = null;
  let nd = 1e9;
  const boss = s.mobs.find((m) => m.kind === 'f11boss');
  const shield = !!boss && !!s.boss?.data.shield;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || (m.data.ghost ?? 0) > 0) continue;
    if (shield && m.kind === 'f11boss') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y) - (m.kind === 'f11_pylon' ? 4 : 0);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near) nd = Math.hypot(near.x - h.x, near.y - h.y);
  if (near && nd < 14) {
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
  }
  // Ветер к краю — упереться: если по ветру за шагом небо, идти против.
  if (fst) {
    const [wx, wy] = windAt(fst, h.x, h.y, [0, 0]);
    const wl = Math.hypot(wx, wy);
    if (wl > 1.5 && !safeFloor(s, h.x + (wx / wl) * 1.6, h.y + (wy / wl) * 1.6)) {
      inp.mx = -wx / wl + inp.mx * 0.3;
      inp.my = -wy / wl + inp.my * 0.3;
      const l = Math.hypot(inp.mx, inp.my) || 1;
      inp.mx /= l;
      inp.my /= l;
    }
  }
  keepOn(s, inp);
  return inp;
}

const bossObj = world.objs.find((o) => o.kind === 'boss')!;

interface Fight {
  won: number;
  s: Sim;
  phases: number;
  low: number;
  blown: number;
}

function fight(tier: number, plus: number, seed: number, meat = 4): Fight {
  const s = sim(tier, plus, bossObj.x + 0.5, bossObj.y + 7.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.22, 0.45], miss: 0.12, seed };
  let won = -1;
  let phases = 0;
  let low = 1;
  let blown = 0;
  const seenModes = new Map<string, number>();
  for (let t = 0; t < 420 * 60; t++) {
    stepSim(s, DT, bot(s, st));
    low = Math.min(low, s.hero.hp / s.stats.maxHp);
    const k = s.mobs.find((m) => m.kind === 'f11boss');
    if (k) seenModes.set(k.mode, (seenModes.get(k.mode) ?? 0) + DT);
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'phase') phases += 1;
      if (e.t === 'boss' && e.what === 'f11_blow_trap') blown += 1;
    }
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  if (LOG) {
    const k = s.mobs.find((m) => m.kind === 'f11boss');
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фаз ${phases}, страж ${k ? Math.round((100 * k.hp) / k.maxHp) : 0}%, минимум здоровья ${Math.round(low * 100)}%, сдуло ${blown}, мяса ${s.sack.meat.f11_fillet ?? 0}`,
      [...seenModes].map(([m, v]) => `${m}:${v.toFixed(0)}`).join(' '),
    );
  }
  return { won, s, phases, low, blown };
}

describe('этаж 11: Древний страж', () => {
  it('на Т8+5 с едой бот побеждает за 2–6 минут, проходя все четыре фазы', () => {
    const res = [41, 42, 43, 44].map((seed) => fight(8, 5, seed));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(120);
      expect(r.won).toBeLessThan(360);
      expect(r.phases).toBe(3);
    }
    // Не прогулка: хоть раз страж доводит бота до края или побеждает.
    expect(res.some((r) => r.won < 0 || r.low < 0.45)).toBe(true);
  });

  it('на Т8+0 без еды — смерть чаще победы', () => {
    const res = [51, 52, 53].map((seed) => fight(8, 0, seed, 0).won);
    expect(res.filter((t) => t > 0).length).toBeLessThanOrEqual(1);
  });
});

describe.runIf(!!process.env.F11SWEEP)('этаж 11: подбор', () => {
  it('сетка снаряжения', () => {
    for (const [tier, plus, meat] of (process.env.F11SWEEP ?? '').split(';').map((x) => x.split(',').map(Number)))
      for (const seed of [61, 62, 63, 64]) fight(tier, plus, seed, meat);
  });
});

// ---------------------------------------------------------------------------
// Дорога и арена.
// ---------------------------------------------------------------------------

/** Поле расстояний до цели — бот идёт по нему. `extra` — что считать полом. */
function field(tx: number, ty: number, tiles: Uint8Array = world.tiles, extra?: (i: number) => boolean): Int32Array {
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
      if (f[j] >= 0 || !(walkableTile(t) || t === Tile.Gate || extra?.(j))) continue;
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

const liftObj = world.objs.find((o) => o.kind === 'lift' && o.area === F11_GARDEN)!;

describe('этаж 11: дорога', () => {
  it('от лифта Садов до ворот арены — есть путь (плиты бегущего моста считаются, когда встали)', () => {
    const s = sim(8, 5, liftObj.x + 0.5, liftObj.y + 1.5, 1);
    stepSim(s, DT, NO_INPUT);
    const st = F11_DEBUG.stateOf(s);
    const plates = new Set(st.bridge.cells.flat());
    const gate = s.boss!.gates[0];
    const f = field(gate % W, Math.floor(gate / W), s.tiles, (i) => plates.has(i));
    expect(f[(liftObj.y + 1) * W + liftObj.x]).toBeGreaterThan(0);
    // Без плит — тоже: вторая дорога идёт через аркаду и площадь башни.
    const g = field(gate % W, Math.floor(gate / W), s.tiles);
    expect(g[(liftObj.y + 1) * W + liftObj.x]).toBeGreaterThan(0);
    // А акведук без плит разорван: с южной части на северную по нему не пройти.
    const aq = band(F11_AQUA).top;
    const north = field(44, aq + 50, s.tiles);
    const southI = (aq + 78) * W + 44;
    const viaAqueductOnly = (i: number) => {
      const x = i % W;
      const y = Math.floor(i / W) - aq;
      return x >= 40 && x <= 48 && y >= 36 && y <= 80;
    };
    const n2 = field(44, aq + 50, s.tiles.map((t, i) => (viaAqueductOnly(i) ? t : Tile.Wall)) as Uint8Array);
    expect(n2[southI]).toBe(-1);
    expect(north[southI]).toBeGreaterThan(0);
  });

  it('бегущий мост: плиты встают волной по очереди, каждая хоть раз стоит', () => {
    const st0 = F11_DEBUG.stateOf(sim(8, 5, 1, 1, 1));
    const [bx, by] = [(st0.bridge.x0 + st0.bridge.x1) / 2, st0.bridge.lipS];
    const s = sim(8, 5, bx + 0.5, by + 1.5, 2);
    const st = F11_DEBUG.stateOf(s);
    const upAt: number[] = st.bridge.cells.map(() => -1);
    for (let t = 0; t < 20 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      s.mobs = [];
      stepSim(s, DT, NO_INPUT);
      st.bridge.cells.forEach((row, k) => {
        if (upAt[k] < 0 && row.every((i) => walkableTile(s.tiles[i]))) upAt[k] = s.time;
      });
    }
    expect(upAt.every((t) => t > 0)).toBe(true);
  });

  it('после победы с арены выходят, ворота не захлопываются на герое', () => {
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
    const N = 24;
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
        h.hp = s.stats.maxHp;
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
});

/** Довести до «Падения острова» и дать краю рушиться. */
function toFall(s: Sim, secs: number): void {
  const h = s.hero;
  for (let t = 0; t < secs * 60; t++) {
    h.hp = s.stats.maxHp;
    const k = s.mobs.find((m) => m.kind === 'f11boss');
    const b = s.boss!;
    if (k && b.state === 'fight' && b.phase < 4 && k.mode !== 'f11_wake' && k.mode !== 'f11_shift') {
      k.hp = k.maxHp * (b.phase === 1 ? 0.7 : b.phase === 2 ? 0.45 : 0.2);
      b.data.shield = 0;
    }
    s.mobs = s.mobs.filter((m) => m.kind === 'f11boss');
    stepSim(s, DT, NO_INPUT);
  }
}

describe('этаж 11: арена', () => {
  it('в «Падении острова» край уходит кольцами, середина и дорога к воротам целы', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 4.5, 5);
    const b = s.boss!;
    const before = [...b.cells].filter((i) => s.tiles[i] === Tile.Deep).length;
    for (let k = 0; k < 20 && b.phase < 4; k++) toFall(s, 0.5);
    expect(b.phase).toBe(4);
    toFall(s, 1.2);
    const cracking = [...b.cells].filter((i) => s.world.mark[i] === F11_MARK.cracking);
    expect(cracking.length).toBeGreaterThan(12);
    expect(cracking.every((i) => s.tiles[i] !== Tile.Deep)).toBe(true);
    toFall(s, 30);
    const deep = [...b.cells].filter((i) => s.tiles[i] === Tile.Deep);
    expect(deep.length - before).toBeGreaterThan(40);
    const st = F11_DEBUG.stateOf(s);
    for (const i of deep) expect(Math.hypot((i % W) + 0.5 - st.arena.cx, Math.floor(i / W) + 0.5 - st.arena.cy)).toBeGreaterThan(5.5);
    const f = field(b.gates[0] % W, Math.floor(b.gates[0] / W), s.tiles);
    expect(f[Math.floor(st.arena.cy) * W + Math.floor(st.arena.cx)]).toBeGreaterThan(0);
  });

  it('герой на уходящем краю не падает насквозь: его сдувает на целую плиту арены', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 4.5, 6);
    const b = s.boss!;
    for (let k = 0; k < 20 && b.phase < 4; k++) toFall(s, 0.5);
    toFall(s, 1);
    const edge = [...b.cells].find((i) => s.world.mark[i] === F11_MARK.cracking)!;
    expect(edge).toBeDefined();
    s.hero.x = (edge % W) + 0.5;
    s.hero.y = Math.floor(edge / W) + 0.5;
    let fell = false;
    for (let t = 0; t < 4 * 60; t++) {
      s.hero.inv = Math.min(s.hero.inv, 0.2);
      s.mobs = s.mobs.filter((m) => m.kind === 'f11boss');
      stepSim(s, DT, NO_INPUT);
      if (s.events.some((e) => e.t === 'boss' && e.what === 'f11_blow_trap')) fell = true;
    }
    expect(fell).toBe(true);
    expect(walkableTile(s.tiles[Math.floor(s.hero.y) * W + Math.floor(s.hero.x)])).toBe(true);
    expect(b.cells.has(Math.floor(s.hero.y) * W + Math.floor(s.hero.x))).toBe(true);
    expect(b.state).toBe('fight');
    expect(s.hero.hp).toBeGreaterThan(0);
  });

  it('смерть в бою возвращает арену целой и гасит купол', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 4.5, 7);
    const b = s.boss!;
    const tiles0 = s.tiles.slice();
    const marks0 = s.world.mark.slice();
    toFall(s, 24);
    expect([...b.cells].some((i) => s.tiles[i] !== tiles0[i])).toBe(true);
    s.hero.inv = 0;
    API.hurtHero(s, s.stats.maxHp * 50, s.hero.x, s.hero.y, 0);
    expect(b.state).toBe('idle');
    for (const i of b.cells) {
      if (b.gates.includes(i)) continue;
      expect(s.tiles[i]).toBe(tiles0[i]);
      expect(s.world.mark[i]).toBe(marks0[i]);
    }
    expect(s.mobs.some((m) => m.kind === 'f11_pylon')).toBe(false);
  });

  it('купол: пока стоят пилоны, страж неуязвим; пилоны пали — он на колене', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 4.5, 9);
    const b = s.boss!;
    let k: Mob | undefined;
    for (let t = 0; t < 6 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      k = s.mobs.find((m) => m.kind === 'f11boss');
      if (k && b.state === 'fight' && b.phase === 1 && k.mode !== 'f11_wake') k.hp = k.maxHp * 0.7;
      stepSim(s, DT, NO_INPUT);
      if (b.phase === 2 && b.data.shield) break;
    }
    expect(b.phase).toBe(2);
    expect(b.data.shield).toBe(1);
    const pylons = s.mobs.filter((m) => m.kind === 'f11_pylon');
    expect(pylons.length).toBe(3);
    // Удар по стражу под куполом не проходит.
    const hp0 = k!.hp;
    s.hero.x = k!.x;
    s.hero.y = k!.y + k!.r + 0.6;
    for (let t = 0; t < 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, { ...NO_INPUT, attack: t % 10 === 0, aim: { x: 0, y: -1 } });
    }
    expect(k!.hp).toBe(hp0);
    // Пилоны разбиты — купол пал.
    for (const p of pylons) API.explode(s, p.x, p.y, 0.2, p.maxHp * 3, 0);
    let stag = false;
    for (let t = 0; t < 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      if (k!.mode === 'f11_stagger') stag = true;
    }
    expect(b.data.shield).toBe(0);
    expect(stag).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ветер.
// ---------------------------------------------------------------------------

describe('этаж 11: ветер', () => {
  it('на первом мосту боковой поток сносит стоящего героя к краю', () => {
    const [bx, by] = at(F11_GARDEN, 32, 84);
    const s = sim(8, 5, bx + 0.5, by + 0.5, 3);
    s.mobs = [];
    const st = F11_DEBUG.stateOf(s);
    const [wx] = windAt(st, bx + 0.5, by + 0.5, [0, 0], true);
    expect(Math.abs(wx)).toBeGreaterThan(1);
    const x0 = s.hero.x;
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    expect(Math.sign(s.hero.x - x0)).toBe(Math.sign(wx));
  });

  it('сдуло с края: урон окружением (12%), возврат на твёрдое, событие', () => {
    const [bx, by] = at(F11_GARDEN, 32, 84);
    const s = sim(8, 5, bx + 0.5, by + 0.5, 4);
    s.mobs = [];
    for (let t = 0; t < 60; t++) stepSim(s, DT, NO_INPUT);
    const st = F11_DEBUG.stateOf(s);
    s.hero.inv = 0;
    const hp0 = s.hero.hp;
    F11_DEBUG.blowOff(s, st, API, 'СДУЛО');
    expect(hp0 - s.hero.hp).toBeGreaterThan(s.stats.maxHp * 0.1);
    expect(hp0 - s.hero.hp).toBeLessThan(s.stats.maxHp * 0.14);
    expect(standable(s, s.hero.x, s.hero.y)).toBe(true);
    expect(s.events.some((e) => e.t === 'boss' && e.what === 'f11_blow_trap')).toBe(true);
  });

  it('идти против потока можно: герой пересекает первый мост', () => {
    const [bx, by] = at(F11_GARDEN, 32, 89);
    const s = sim(8, 5, bx + 0.5, by + 0.5, 5);
    const st = F11_DEBUG.stateOf(s);
    const goalY = band(F11_GARDEN).top + 74;
    let blown = 0;
    for (let t = 0; t < 20 * 60 && s.hero.y > goalY + 0.5; t++) {
      s.mobs = [];
      s.hero.hp = s.stats.maxHp;
      const [wx, wy] = windAt(st, s.hero.x, s.hero.y, [0, 0]);
      const cx = bx + 0.5 - s.hero.x;
      const inp = { ...NO_INPUT, mx: cx * 1.2 - wx * 0.15, my: -1 - wy * 0.1 };
      const l = Math.hypot(inp.mx, inp.my);
      inp.mx /= l;
      inp.my /= l;
      stepSim(s, DT, inp);
      blown += s.events.filter((e) => e.t === 'boss' && e.what === 'f11_blow_trap').length;
    }
    expect(s.hero.y).toBeLessThan(goalY + 0.6);
    expect(blown).toBeLessThanOrEqual(1);
  });

  it('ветряк поворачивает поток моста на четверть оборота', () => {
    const s = sim(8, 5, 1, 1, 6);
    stepSim(s, DT, NO_INPUT);
    const st = F11_DEBUG.stateOf(s);
    const mill = st.mills[0];
    const g = mill.turns[0][0];
    const d0 = st.groups[g].dir;
    expect(F11_DEBUG.turnMill(s, st, mill)).toBe(true);
    const d1 = st.groups[g].dir;
    const diff = Math.abs(Math.atan2(Math.sin(d1 - d0), Math.cos(d1 - d0)));
    expect(diff).toBeCloseTo(Math.PI / 2, 3);
    // Сразу второй раз — нельзя: ветряк раскручивается.
    expect(F11_DEBUG.turnMill(s, st, mill)).toBe(false);
  });

  it('лебёдка поднимает плиты к островку, потом они трещат и уходят', () => {
    const s = sim(8, 5, 1, 1, 7);
    stepSim(s, DT, NO_INPUT);
    const st = F11_DEBUG.stateOf(s);
    expect(st.winch.cells.length).toBeGreaterThan(3);
    expect(st.winch.cells.every((i) => s.tiles[i] === Tile.Deep)).toBe(true);
    expect(F11_DEBUG.pullWinch(s, st, API)).toBe(true);
    for (let t = 0; t < 4 * 60; t++) stepSim(s, DT, NO_INPUT);
    expect(st.winch.cells.every((i) => walkableTile(s.tiles[i]))).toBe(true);
    for (let t = 0; t < 60 * 60 && st.winch.state !== 'down'; t++) stepSim(s, DT, NO_INPUT);
    expect(st.winch.state).toBe('down');
    expect(st.winch.cells.every((i) => s.tiles[i] === Tile.Deep)).toBe(true);
  });

  it('стража у обрыва сдувает в небо струёй заслонки — это убийство', () => {
    const s = sim(8, 5, 1, 1, 8);
    stepSim(s, DT, NO_INPUT);
    const st = F11_DEBUG.stateOf(s);
    // Клетка потока заслонки, за которой по ветру — небо.
    let spot = -1;
    let k = 0;
    for (; k < 2 && spot < 0; k++) {
      const g = st.groups[4 + k];
      if (!g) continue;
      for (let i = 0; i < st.grp.length && spot < 0; i++) {
        if (st.grp[i] !== 4 + k || !walkableTile(s.tiles[i])) continue;
        const x = (i % W) + 0.5 + Math.cos(g.dir) * 1.1;
        const y = Math.floor(i / W) + 0.5 + Math.sin(g.dir) * 1.1;
        if (s.tiles[Math.floor(y) * W + Math.floor(x)] === Tile.Deep) spot = i;
      }
    }
    expect(spot).toBeGreaterThan(0);
    k -= 1;
    const g = st.groups[4 + k];
    const x0 = (spot % W) + 0.5 - Math.cos(g.dir) * 0.3;
    const y0 = Math.floor(spot / W) + 0.5 - Math.sin(g.dir) * 0.3;
    s.hero.x = x0 - Math.cos(g.dir) * 6;
    s.hero.y = y0 - Math.sin(g.dir) * 6;
    s.mobs = [];
    const m = spawnMob(s, 'f11_guard', x0, y0, { mode: 'f11_dormant' });
    let fell = false;
    let quiet = true;
    for (let t = 0; t < 60; t++) {
      stepSim(s, DT, NO_INPUT);
      if (m.fell) quiet = false;
    }
    // Без струи тяжёлый страж стоит.
    expect(quiet).toBe(true);
    expect(F11_DEBUG.openValve(s, st, API, k)).toBe(true);
    for (let t = 0; t < 6 * 60 && !fell; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      if (m.fell || !s.mobs.includes(m)) fell = true;
    }
    expect(fell).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Залы-события: начинаются, когда подходишь, кончаются наградой.
// ---------------------------------------------------------------------------

/** Пройти событие: герой стоит в зале, всё, что прилетело, гибнет. */
function runHall(key: 'raid' | 'tower' | 'garden' | 'storm'): { waves: number; done: boolean; paid: boolean; st: ReturnType<typeof F11_DEBUG.stateOf> } {
  const probe = sim(8, 5, 1, 1, 1);
  const hs = F11_DEBUG.stateOf(probe)[key];
  const s = sim(8, 5, hs.cx, hs.cy + 1, 12);
  s.mobs = [];
  const st = F11_DEBUG.stateOf(s);
  let waves = 0;
  for (let t = 0; t < 120 * 60 && st[key].state !== 'done'; t++) {
    s.hero.hp = s.stats.maxHp;
    s.hero.inv = 1;
    if (key === 'garden' && st.garden.state === 'idle' && t > 30) F11_DEBUG.startGarden(s, st, API);
    stepSim(s, DT, NO_INPUT);
    if (s.events.some((e) => e.t === 'boss' && e.what === 'summon')) waves += 1;
    if (t % 20 === 0)
      for (const m of [...s.mobs])
        if (m.mode !== 'dying' && m.mode !== 'f11_land' && (m.data.ghost ?? 0) === 0 && !MOBS[m.kind].boss)
          API.explode(s, m.x, m.y, 0.1, m.maxHp * 3, 0);
  }
  return { waves, done: st[key].state === 'done', paid: st[key].paid, st };
}

describe('этаж 11: события', () => {
  it('«Абордаж» в Верхнем саду: три волны с краёв острова, потом награда', () => {
    const r = runHall('raid');
    expect(r.done).toBe(true);
    expect(r.waves).toBe(3);
    expect(r.paid).toBe(true);
  });

  it('«Гнездо гарпий»: башня крутит ветер, волны гарпий, потом тишина', () => {
    const r = runHall('tower');
    expect(r.done).toBe(true);
    expect(r.waves).toBeGreaterThanOrEqual(3);
  });

  it('«Пробуждение сада» с пульта кончается наградой', () => {
    const r = runHall('garden');
    expect(r.done).toBe(true);
  });

  it('«Буря» во Внешнем дворе проходит и стихает', () => {
    const r = runHall('storm');
    expect(r.done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Монстры: не застревают в стенах, не проваливаются сами.
// ---------------------------------------------------------------------------

describe('этаж 11: монстры', () => {
  const spots: [string, number, number][] = [
    [F11_GARDEN, 32, 60],
    [F11_AQUA, 30, 30],
    [F11_CASTLE, 32, 76],
  ];
  const kinds = ['f11_ray', 'f11_gardener', 'f11_guard', 'f11_harpy', 'f11_jelly', 'f11_boarder', 'f11_moss', 'f11_spirit', 'f11_drone'];
  for (const [area, lx, ly] of spots)
    it(`в районе ${area} за 25 с боя никто не сидит в стене`, () => {
      const [x, y] = at(area, lx, ly);
      const s = sim(8, 5, x + 0.5, y + 0.5, 11);
      s.mobs = [];
      const list = kinds.map((k, i) => {
        const a = (i / kinds.length) * Math.PI * 2;
        let px = x + 0.5 + Math.cos(a) * 3;
        let py = y + 0.5 + Math.sin(a) * 3;
        if (!standable(s, px, py)) {
          px = x + 0.5;
          py = y + 0.5;
        }
        return spawnMob(s, k as Mob['kind'], px, py, { mode: 'chase' });
      });
      for (let t = 0; t < 25 * 60; t++) {
        s.hero.hp = s.stats.maxHp;
        stepSim(s, DT, NO_INPUT);
      }
      for (const m of list) {
        if (!s.mobs.includes(m) || m.fell) continue;
        const t = s.tiles[Math.floor(m.y) * W + Math.floor(m.x)];
        expect(t, `${m.kind} в ${m.x.toFixed(1)},${m.y.toFixed(1)}`).not.toBe(Tile.Wall);
      }
    });
});
