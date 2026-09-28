// Этаж 13 «Город за стенами»: бот против Колосса (крюки за спину, пушки,
// затылок), выход с арены, сброс арены после смерти, дорога от лифта к
// воротам арены — и механики этажа: затылок исполина, крюк над провалом,
// пушка валит исполинов, валун закрывает пролом, набат глушит, каждый
// удар с меткой.
//
// Бот — живой игрок средней руки: видит метки на полу и уходит из них
// рывком за миг до удара (с задержкой реакции и изредка проглядев), ест,
// когда здоровья меньше 40%. Против исполинов он заходит за спину и бьёт в
// затылок, а если исполин смотрит на него, а рядом столб — берёт крюк.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, Tile, walkableTile } from '../dungeon-world';
import type { WorldObj } from '../dungeon-world';
import {
  API,
  createSim,
  NO_INPUT,
  spawnMob,
  stepSim,
  strikeHits,
  SWORD,
  usableNear,
  useObject,
} from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import { CANNON, COL, f13State, GIANT, HOOK } from './f13-brains';
import { F13_BELL, F13_GIANTS, F13_MARK, F13_OUTER, F13_WALL } from './f13';
import { F13_HOOKS } from './f13-map';

const world = buildWorld(13);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F13LOG;

const band = (id: string) => world.bands.find((b) => b.def.id === id)!;
/** Мировая клетка по местным координатам района. */
const at = (area: string, x: number, y: number): [number, number] => [x, band(area).top + y];

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 13 };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7, meat = 0): Sim {
  const d = dungeon(tier, plus);
  const s = createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
  if (meat) {
    s.sack.meat.f13_ration = meat;
    s.sack.meatBy[F13_BELL] = meat;
  }
  return s;
}

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// ---------------------------------------------------------------------------
// Бот.
// ---------------------------------------------------------------------------

interface BotState {
  lastAtk: number;
  react: [number, number];
  miss: number;
  seed: number;
  seen?: Map<string, [number, boolean]>;
  hooks: number;
  cannons: number;
  cannonAt?: number;
  cannonRest?: number;
  /** Куда идти, когда драться не с кем (поле расстояний). */
  goal?: { f: Int32Array; x: number; y: number };
}

function rnd(st: BotState): number {
  st.seed = (Math.imul(st.seed, 1664525) + 1013904223) >>> 0;
  return st.seed / 4294967296;
}

function notice(st: BotState, key: string): [number, boolean] {
  st.seen ??= new Map();
  let v = st.seen.get(key);
  if (!v) {
    v = [st.react[0] + rnd(st) * (st.react[1] - st.react[0]), rnd(st) < st.miss];
    st.seen.set(key, v);
    if (st.seen.size > 600) st.seen.clear();
  }
  return v;
}

const floorAt = (s: Sim, x: number, y: number) => walkableTile(s.tiles[Math.floor(y) * W + Math.floor(x)]);

/** Уйти от ударов, облаков и замахов; null — опасности нет. */
function dodge(s: Sim, st: BotState): SimInput | null {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  for (const z of s.strikes) {
    if (z.dmg <= 0) continue;
    const left = z.warn - z.t;
    const [react, missed] = notice(st, `s${z.id}`);
    if (missed || z.t < react || !strikeHits(z, h.x, h.y, h.r + 0.3)) continue;
    let ax = h.x - z.x;
    let ay = h.y - z.y;
    if ((z.shape === 'cone' || z.shape === 'line') && z.ang !== undefined) {
      const side = Math.sin((z.ang ?? 0) - Math.atan2(ay, ax)) > 0 ? -1 : 1;
      const a = (z.ang ?? 0) + side * (z.shape === 'line' ? Math.PI / 2 : 1.9);
      ax = Math.cos(a);
      ay = Math.sin(a);
    }
    if (z.shape === 'ring') {
      // Внутрь — только если внутри кольца есть место (не в теле исполина).
      const d = Math.hypot(ax, ay) || 1;
      const w = z.w ?? 0.6;
      const src = s.mobs.find((m) => m.id === z.from);
      const inner = z.r - w - h.r - 0.3;
      const room = inner - (src ? src.r * 0.9 + h.r : 0);
      if (room > 0.6 && d - inner < z.r + w + h.r + 0.3 - d) {
        ax = -ax;
        ay = -ay;
      }
    }
    const l = Math.hypot(ax, ay) || 1;
    inp.mx = ax / l;
    inp.my = ay / l;
    if (!floorAt(s, h.x + inp.mx * 2, h.y + inp.my * 2)) {
      inp.mx = -ay / l;
      inp.my = ax / l;
    }
    if (left < 0.24 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Навесом: метка приземления видна — уйти из круга.
  for (const sh of s.shots) {
    const lb = sh.lob;
    if (!lb) continue;
    const [react, missed] = notice(st, `b${sh.id}`);
    if (missed || sh.age < react) continue;
    const d = Math.hypot(h.x - lb.x1, h.y - lb.y1);
    const R = (sh.onLand?.r ?? sh.r) + h.r + 0.3;
    if (d > R) continue;
    let ax = h.x - lb.x1;
    let ay = h.y - lb.y1;
    if (d < 0.05) {
      ax = 1;
      ay = 0;
    }
    const l = Math.hypot(ax, ay);
    inp.mx = ax / l;
    inp.my = ay / l;
    if (lb.T - sh.age < 0.3 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  for (const m of s.mobs) {
    const t = m.tele;
    if (!t || m.mode === 'dying') continue;
    const [react, missed] = notice(st, `t${m.id}:${m.mode}:${Math.floor(s.time - m.t)}`);
    if (missed || m.t < react) continue;
    const hit = strikeHits(
      { shape: t.shape, x: t.x ?? m.x, y: t.y ?? m.y, r: t.r, w: t.w, ang: t.ang, arc: t.arc, warn: 1, dmg: 0 },
      h.x,
      h.y,
      h.r + 0.3,
    );
    if (!hit) continue;
    const a = (t.ang ?? Math.atan2(h.y - m.y, h.x - m.x)) + Math.PI / 2;
    const side = Math.cos(a) * (h.x - m.x) + Math.sin(a) * (h.y - m.y) >= 0 ? 1 : -1;
    inp.mx = Math.cos(a) * side;
    inp.my = Math.sin(a) * side;
    if (m.danger > 0 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  for (const m of s.mobs) {
    if (m.mode !== 'windup') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const [react, missed] = notice(st, `w${m.id}:${Math.floor(s.time - m.t)}`);
    if (!missed && m.t > react && d < MOBS[m.kind].reach + m.r + 0.9 && h.dashCd <= 0) {
      const away = Math.atan2(h.y - m.y, h.x - m.x) + 0.9;
      inp.mx = Math.cos(away);
      inp.my = Math.sin(away);
      inp.dash = true;
      return inp;
    }
  }
  for (const z of s.zones) {
    if (!z.dps || z.t < (z.warn ?? 0) - 0.25) continue;
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d < z.r + h.r + 0.2) {
      inp.mx = (h.x - z.x) / (d || 1);
      inp.my = (h.y - z.y) / (d || 1);
      return inp;
    }
  }
  // Трещит под ногами — к целой плите.
  const here = Math.floor(h.y) * W + Math.floor(h.x);
  if (s.world.mark[here] === F13_MARK.cracking) {
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
      [1, 1],
      [-1, 1],
    ]) {
      const j = here + dy * W + dx;
      if (walkableTile(s.tiles[j]) && s.world.mark[j] !== F13_MARK.cracking) {
        inp.mx = dx;
        inp.my = dy;
        return inp;
      }
    }
  }
  return null;
}

/** Точка за спиной исполина — ходим по кругу, а не сквозь него. */
function circleBehind(s: Sim, g: Mob): SimInput {
  const h = s.hero;
  const want = g.face + Math.PI;
  const R = g.r + (g.kind === 'f13boss' ? 1.1 : 0.9);
  const cur = Math.atan2(h.y - g.y, h.x - g.x);
  const d = Math.hypot(h.x - g.x, h.y - g.y);
  const da = angDiff(want, cur);
  let mx: number;
  let my: number;
  if (Math.abs(da) < 0.35) {
    // Уже за спиной — подойти на расстояние удара.
    const tx = g.x + Math.cos(want) * R;
    const ty = g.y + Math.sin(want) * R;
    mx = tx - h.x;
    my = ty - h.y;
  } else {
    // По кругу в сторону спины, держа радиус.
    const t = cur + Math.sign(da) * Math.min(1.1, Math.abs(da));
    const tx = g.x + Math.cos(t) * Math.max(R, 2.2 + g.r * 0.4);
    const ty = g.y + Math.sin(t) * Math.max(R, 2.2 + g.r * 0.4);
    mx = tx - h.x;
    my = ty - h.y;
    if (d < g.r + 0.6) {
      mx += (h.x - g.x) * 2;
      my += (h.y - g.y) * 2;
    }
  }
  const l = Math.hypot(mx, my);
  return l < 0.15 ? { ...NO_INPUT } : { ...NO_INPUT, mx: mx / l, my: my / l };
}

const hooksOf = (s: Sim) => f13State(s)?.hooks ?? [];

/** Столб рядом и исполин смотрит — крюк за спину. */
function tryHook(s: Sim, st: BotState, g: Mob, force: boolean): SimInput | null {
  const h = s.hero;
  const rel = Math.abs(angDiff(Math.atan2(h.y - g.y, h.x - g.x), g.face));
  if (!force && rel > 1.4) return null;
  let best: { x: number; y: number; obj: WorldObj } | null = null;
  let bd = force ? 9 : 4;
  for (const hk of hooksOf(s)) {
    if (!hk.combat || hk.cd > 0) continue;
    if (Math.hypot(g.x - hk.x, g.y - hk.y) > HOOK.range - 1) continue;
    const d = Math.hypot(hk.x - h.x, hk.y - h.y);
    if (d < bd) {
      bd = d;
      best = { x: hk.x, y: hk.y, obj: hk.obj };
    }
  }
  if (!best) return null;
  const u = usableNear(s);
  if (u && u.kind === 'floor' && u.obj === best.obj) {
    if (useObject(s, u)) st.hooks += 1;
    return { ...NO_INPUT };
  }
  const l = Math.hypot(best.x - h.x, best.y + 0.6 - h.y) || 1;
  return { ...NO_INPUT, mx: (best.x - h.x) / l, my: (best.y + 0.6 - h.y) / l };
}

/**
 * Пушка: в «Топоте» и дальше бот иногда уходит за пушку и ждёт, когда
 * Колосс войдёт в полосу (он идёт за героем), — и стреляет. Ждёт недолго.
 */
function tryCannon(s: Sim, st: BotState, g: Mob): SimInput | null {
  const h = s.hero;
  if (s.time < (st.cannonRest ?? 0)) return null;
  let best: { c: NonNullable<ReturnType<typeof f13State>>['cannons'][number]; d: number } | null = null;
  for (const c of f13State(s)?.cannons ?? []) {
    if (c.reload > 0 || !s.boss || !API.inArena(s, c.x, c.y)) continue;
    const d = Math.hypot(c.x - h.x, c.y - h.y);
    if (d < 16 && (!best || d < best.d)) best = { c, d };
  }
  if (!best) return null;
  const c = best.c;
  st.cannonAt ??= s.time;
  if (s.time - st.cannonAt > 9) {
    st.cannonAt = undefined;
    st.cannonRest = s.time + 14;
    return null;
  }
  const ux = Math.cos(c.ang);
  const uy = Math.sin(c.ang);
  const dx = g.x - c.x;
  const dy = g.y - c.y;
  const along = dx * ux + dy * uy;
  const across = Math.abs(-dx * uy + dy * ux);
  const u = usableNear(s);
  if (u && u.kind === 'floor' && u.obj === c.obj) {
    if (along > 1 && along < c.len && across < CANNON.w + g.r * 0.7) {
      if (useObject(s, u)) {
        st.cannons += 1;
        st.cannonAt = undefined;
        st.cannonRest = s.time + 6;
      }
    }
    return { ...NO_INPUT };
  }
  // За пушку: на полклетки позади лафета.
  const tx = c.x + 0.5 - ux * 1.1;
  const ty = c.y + 0.5 - uy * 1.1;
  const l = Math.hypot(tx - h.x, ty - h.y) || 1;
  return { ...NO_INPUT, mx: (tx - h.x) / l, my: (ty - h.y) / l };
}

function attackAt(s: Sim, st: BotState, m: Mob, inp: SimInput): SimInput {
  const h = s.hero;
  const d = Math.hypot(m.x - h.x, m.y - h.y);
  if (d < SWORD.reach + m.r + 0.1 && s.time - st.lastAtk > 0.14) {
    inp.attack = true;
    inp.aim = { x: m.x - h.x, y: m.y - h.y };
    st.lastAtk = s.time;
  }
  return inp;
}

function bot(s: Sim, st: BotState): SimInput {
  const h = s.hero;
  const fl = f13State(s);
  if (fl?.flight || h.pull) return { ...NO_INPUT };
  const dg = dodge(s, st);
  if (dg) return dg;
  const meat = Object.values(s.sack.meat).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) return { ...NO_INPUT, eat: true };
  // Колосс — главная цель.
  const col = s.mobs.find((m) => m.kind === 'f13boss' && m.mode !== 'dying');
  if (col && col.mode !== 'rise') {
    if (col.mode === 'kneel') return attackAt(s, st, col, circleBehind(s, col));
    const phase = s.boss?.phase ?? 0;
    const bare = (col.data.bareT ?? 0) > 0;
    const cn = phase >= 2 ? tryCannon(s, st, col) : null;
    if (cn) return cn;
    if (phase === 1 && !bare) {
      const hk = tryHook(s, st, col, true);
      if (hk) return hk;
    }
    // Мелочь вплотную — сперва её.
    const pest = s.mobs.find((m) => m !== col && m.mode !== 'dying' && Math.hypot(m.x - h.x, m.y - h.y) < 1.6);
    if (pest) return attackAt(s, st, pest, { ...NO_INPUT });
    const hk = tryHook(s, st, col, false);
    if (hk) return hk;
    return attackAt(s, st, col, circleBehind(s, col));
  }
  // В пути — идти и отбиваться на ходу: у нор бесконечная мелочь, и бот,
  // что встаёт драться с каждой, стоит у первой норы до конца.
  if (st.goal) {
    const inp = follow(s, st.goal.f, st.goal.x, st.goal.y);
    let tgt: Mob | null = null;
    let td = 1e9;
    for (const m of s.mobs) {
      if (m.mode === 'dying' || (m.data.ghost ?? 0) > 0) continue;
      const d = Math.hypot(m.x - h.x, m.y - h.y);
      if (d < SWORD.reach + m.r + 0.1 && d < td) {
        td = d;
        tgt = m;
      }
    }
    // Исполин вплотную спереди — обойти за спину, пока бьёт мимо.
    return tgt ? attackAt(s, st, tgt, inp) : inp;
  }
  // Прочие: исполина — со спины, мелочь — в лоб.
  let near: Mob | null = null;
  let nd = 9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || (m.data.ghost ?? 0) > 0 || m.kind === 'f13boss') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near) {
    if (F13_GIANTS.has(near.kind) && near.mode !== 'down') return attackAt(s, st, near, circleBehind(s, near));
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    const inp = { ...NO_INPUT };
    if (nd > SWORD.reach * 0.8 + near.r * 0.5) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
    }
    return attackAt(s, st, near, inp);
  }
  if (st.goal) return follow(s, st.goal.f, st.goal.x, st.goal.y);
  return { ...NO_INPUT };
}

// ---------------------------------------------------------------------------
// Поле расстояний: дорога пешком (крюки не в счёт).
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
      // Решётка открывается только с одной стороны — пешком её не считаем.
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
  for (const d of [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1]) {
    const j = i + d;
    if (f[j] >= 0 && f[j] < bestD) {
      // По диагонали — только если оба соседа проходимы.
      const dx = (j % W) - (i % W);
      const dy = Math.floor(j / W) - Math.floor(i / W);
      if (dx && dy && (f[i + dx] < 0 || f[i + dy * W] < 0)) continue;
      bestD = f[j];
      mx = (j % W) + 0.5 - h.x;
      my = Math.floor(j / W) + 0.5 - h.y;
    }
  }
  const n = Math.hypot(mx, my) || 1;
  return { ...NO_INPUT, mx: mx / n, my: my / n };
}

// ---------------------------------------------------------------------------
// Колосс.
// ---------------------------------------------------------------------------

const bossObj = world.objs.find((o) => o.kind === 'boss')!;

interface Fight {
  won: number;
  s: Sim;
  phases: number;
  low: number;
  hooks: number;
  cannons: number;
}

function fight(tier: number, plus: number, seed: number, meat = 4): Fight {
  const s = sim(tier, plus, bossObj.x + 0.5, bossObj.y + 6.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.22, 0.45], miss: 0.12, seed, hooks: 0, cannons: 0 };
  let won = -1;
  let phases = 0;
  let low = 1;
  const seenModes = new Map<string, number>();
  const hurt = new Map<string, number>();
  let colHp = 1;
  for (let t = 0; t < 480 * 60; t++) {
    stepSim(s, DT, bot(s, st));
    low = Math.min(low, s.hero.hp / s.stats.maxHp);
    const k = s.mobs.find((m) => m.kind === 'f13boss');
    if (k) seenModes.set(k.mode, (seenModes.get(k.mode) ?? 0) + DT);
    if (k && k.mode !== 'dying') colHp = k.hp / k.maxHp;
    let art = '';
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'phase') phases += 1;
      if (e.t === 'strike') art = e.art;
    }
    for (const e of s.events)
      if (e.t === 'hurt') hurt.set(art || 'иное', (hurt.get(art || 'иное') ?? 0) + e.dmg);
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  if (LOG) {
    console.log('  урон:', [...hurt].map(([a, v]) => `${a}:${v}`).join(' '));
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фаз ${phases}, Колосс ${Math.round(colHp * 100)}%, минимум ${Math.round(low * 100)}%, мяса ${s.sack.meat.f13_ration ?? 0}, крюков ${st.hooks}, пушек ${st.cannons}`,
      [...seenModes].map(([m, v]) => `${m}:${v.toFixed(0)}`).join(' '),
    );
  }
  return { won, s, phases, low, hooks: st.hooks, cannons: st.cannons };
}

describe('этаж 13: Колосс', () => {
  it('на Т8+5 с едой бот побеждает за 2–6 минут, проходя все фазы, крюками и пушками', () => {
    const res = [41, 42, 43, 44].map((seed) => fight(8, 5, seed));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(120);
      expect(r.won).toBeLessThan(360);
      expect(r.phases).toBe(3);
      expect(r.hooks).toBeGreaterThan(0);
    }
    expect(res.some((r) => r.cannons > 0)).toBe(true);
    // Не прогулка: хоть раз Колосс доводит бота до края или побеждает.
    expect(res.some((r) => r.won < 0 || r.low < 0.45)).toBe(true);
  });

  it('на Т8+0 без еды — смерть чаще победы', () => {
    const res = [51, 52, 53].map((seed) => fight(8, 0, seed, 0).won);
    expect(res.filter((t) => t > 0).length).toBeLessThanOrEqual(1);
  });
});

describe.runIf(!!process.env.F13SWEEP)('этаж 13: подбор', () => {
  it('сетка снаряжения', () => {
    for (const [tier, plus, meat] of (process.env.F13SWEEP ?? '').split(';').map((x) => x.split(',').map(Number)))
      for (const seed of [61, 62, 63]) fight(tier, plus, seed, meat);
  });
});

// ---------------------------------------------------------------------------
// Площадь Колосса: выход после победы, сброс после смерти.
// ---------------------------------------------------------------------------

/** Разогнать Колосса до фазы (ставит здоровье у засечки). */
function toPhase(s: Sim, phase: number, secs: number): void {
  for (let t = 0; t < secs * 60; t++) {
    s.hero.hp = s.stats.maxHp;
    const k = s.mobs.find((m) => m.kind === 'f13boss' && m.mode !== 'dying');
    if (k && k.mode !== 'rise' && s.boss && s.boss.phase < phase)
      k.hp = Math.min(k.hp, k.maxHp * (COL.hp[phase - 1] - 0.01));
    s.mobs = s.mobs.filter((m) => m.kind === 'f13boss');
    stepSim(s, DT, NO_INPUT);
  }
}

describe('этаж 13: площадь Колосса', () => {
  it('после победы с площади выходят, ворота не захлопываются на герое', () => {
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

  it('«Топот» раскрывает разлом, «Испарение» чернит площадь; смерть возвращает всё', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 6.5, 7);
    const b = s.boss!;
    const tiles0 = s.tiles.slice();
    const marks0 = s.world.mark.slice();
    toPhase(s, 2, 14);
    expect(b.phase).toBe(2);
    toPhase(s, 3, 16);
    expect(b.phase).toBe(3);
    const changed = [...b.cells].filter((i) => s.tiles[i] !== tiles0[i] || s.world.mark[i] !== marks0[i]);
    expect(changed.length).toBeGreaterThan(4);
    // От места Колосса до ворот путь есть и после разлома.
    const f = field(b.gates[0] % W, Math.floor(b.gates[0] / W), s.tiles);
    expect(f[bossObj.y * W + bossObj.x]).toBeGreaterThan(0);
    s.hero.inv = 0;
    API.hurtHero(s, s.stats.maxHp * 50, s.hero.x, s.hero.y, 0);
    expect(b.state).toBe('idle');
    for (const i of b.cells) {
      if (b.gates.includes(i)) continue;
      expect(s.tiles[i]).toBe(tiles0[i]);
      expect(s.world.mark[i]).toBe(marks0[i]);
    }
  });

  it('пар Колосса: крюк за спину срывает пар, в полёте героя не достать', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 6.5, 9);
    toPhase(s, 1, 8);
    expect(s.boss!.phase).toBe(1);
    const k = s.mobs.find((m) => m.kind === 'f13boss')!;
    const hk = hooksOf(s)
      .filter((x) => x.combat && Math.hypot(x.x - k.x, x.y - k.y) < HOOK.range - 1)
      .sort((a, b) => Math.hypot(a.x - k.x, a.y - k.y) - Math.hypot(b.x - k.x, b.y - k.y))[0];
    expect(hk).toBeDefined();
    s.hero.x = hk.x + 0.5;
    s.hero.y = hk.y + 1.2;
    k.data.bareT = 0;
    const u = usableNear(s)!;
    expect(u.kind).toBe('floor');
    expect(useObject(s, u)).toBe(true);
    let bared = false;
    let invAll = true;
    for (let t = 0; t < 3 * 60; t++) {
      if (f13State(s)?.flight && s.hero.inv <= 0 && !s.hero.pull) invAll = false;
      s.mobs = s.mobs.filter((m) => m.kind === 'f13boss');
      stepSim(s, DT, NO_INPUT);
      if ((k.data.bareT ?? 0) > 0) bared = true;
    }
    expect(invAll).toBe(true);
    expect(bared).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Механики: затылок, крюк, пушка, валун, набат, метки.
// ---------------------------------------------------------------------------

describe('этаж 13: механики', () => {
  it('исполин: в лоб почти не берёт, в затылок — втрое', () => {
    const [x, y] = at(F13_OUTER, 31, 30);
    const dmgFrom = (behind: boolean) => {
      const s = sim(8, 5, x + 0.5, y + (behind ? -1.6 : 2.6), 11);
      s.mobs = [];
      const g = spawnMob(s, 'f13_walker', x + 0.5, y + 0.5, { mode: 'stalk' });
      let sum = 0;
      for (let t = 0; t < 4 * 60; t++) {
        g.x = x + 0.5;
        g.y = y + 0.5;
        g.vx = 0;
        g.vy = 0;
        g.face = Math.PI / 2; // смотрит на юг
        g.cd = 9;
        g.data.spinCd = 9;
        g.hp = g.maxHp;
        s.hero.hp = s.stats.maxHp;
        s.hero.x = x + 0.5;
        s.hero.y = y + (behind ? -1.6 : 2.6);
        const inp = { ...NO_INPUT, attack: t % 12 === 0, aim: { x: 0, y: behind ? 1 : -1 } };
        stepSim(s, DT, inp);
        for (const e of s.events) if (e.t === 'hit' && !e.boss) sum += e.dmg;
      }
      return sum;
    };
    const front = dmgFrom(false);
    const back = dmgFrom(true);
    expect(back).toBeGreaterThan(0);
    expect(back / Math.max(1, front)).toBeGreaterThan(12);
    expect(GIANT.f13_walker.back / GIANT.f13_walker.front).toBeCloseTo(30, 0);
  });

  it('крюк переносит через провал у лифта — в полёте героя не достать', () => {
    const [px, py, tx, ty] = F13_HOOKS[F13_OUTER].find((h) => h[0] === 31 && h[1] === 97)!;
    const [x, y] = at(F13_OUTER, px, py);
    const top = band(F13_OUTER).top;
    // Между столбом и кольцом — провал.
    let deep = 0;
    for (let yy = ty + 1; yy < py; yy++) if (world.tiles[(top + yy) * W + tx] === Tile.Deep) deep += 1;
    expect(deep).toBeGreaterThan(3);
    const s = sim(8, 5, x + 0.5, y + 1.2, 12);
    s.mobs = [];
    const u = usableNear(s)!;
    expect(u.obj.ref).toBe('f13_hook');
    expect(useObject(s, u)).toBe(true);
    let inv = true;
    for (let t = 0; t < 3 * 60; t++) {
      if (f13State(s)?.flight && s.hero.inv <= 0) inv = false;
      stepSim(s, DT, NO_INPUT);
      s.mobs = [];
    }
    expect(inv).toBe(true);
    expect(Math.hypot(s.hero.x - (tx + 0.5), s.hero.y - (top + ty + 0.5))).toBeLessThan(1.2);
    expect(walkableTile(s.tiles[Math.floor(s.hero.y) * W + Math.floor(s.hero.x)])).toBe(true);
  });

  it('пушка на Стене валит исполина в полосе', () => {
    const top = band(F13_WALL).top;
    const s = sim(8, 5, 20.5, top + 58.6, 13);
    s.mobs = [];
    stepSim(s, DT, NO_INPUT);
    const c = f13State(s)!.cannons.find((k) => Math.floor(k.x) === 20 && Math.floor(k.y) === top + 60)!;
    if (LOG) console.log('пушки', f13State(s)!.cannons.map((k) => `${k.x},${k.y - top} ${k.ang.toFixed(2)} ${k.len.toFixed(1)}`).join(' | '));
    expect(c).toBeDefined();
    const mid = Math.min(c.len - 1, 8);
    s.mobs = [];
    const g = spawnMob(s, 'f13_walker', c.x + 0.5 + Math.cos(c.ang) * mid, c.y + 0.5 + Math.sin(c.ang) * mid, {
      mode: 'stalk',
    });
    s.hero.x = c.x + 0.5 - Math.cos(c.ang) * 0.9;
    s.hero.y = c.y + 0.5 - Math.sin(c.ang) * 0.9;
    const u = usableNear(s)!;
    expect(u.obj.ref).toBe('f13_cannon');
    expect(useObject(s, u)).toBe(true);
    let down = false;
    for (let t = 0; t < 1.2 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      if (g.mode === 'down' || g.mode === 'dying' || !s.mobs.includes(g)) down = true;
    }
    expect(down).toBe(true);
    expect(c.reload).toBeGreaterThan(0);
  });

  it('валун с лебёдки заваливает пролом', () => {
    const top = band(F13_WALL).top;
    const s = sim(8, 5, 43.5, top + 51.3, 14);
    s.mobs = [];
    stepSim(s, DT, NO_INPUT);
    const st = f13State(s)!;
    expect(st.breach.length).toBeGreaterThan(4);
    const u = usableNear(s)!;
    expect(u.obj.ref).toBe('f13_boulder');
    expect(useObject(s, u)).toBe(true);
    for (let t = 0; t < 1.5 * 60; t++) stepSim(s, DT, NO_INPUT);
    expect(st.breachEv.sealed).toBe(true);
    expect(st.breach.every((i) => !walkableTile(s.tiles[i]))).toBe(true);
    expect(useObject(s, u)).toBe(false);
  });

  it('набат глушит ухмылок и валит исполинов вокруг', () => {
    const [bx, by] = at(F13_BELL, 31, 90);
    const s = sim(8, 5, bx + 0.5, by + 1.6, 15);
    s.mobs = [];
    stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    const grins = [0, 1, 2].map((i) => spawnMob(s, 'f13_grin', bx + 0.5 + (i - 1) * 3, by + 4.5, { mode: 'chase' }));
    const g = spawnMob(s, 'f13_walker', bx + 5.5, by + 0.5, { mode: 'stalk' });
    const u = usableNear(s)!;
    expect(u.obj.ref).toBe('f13_bell');
    expect(useObject(s, u)).toBe(true);
    expect(grins.every((m) => m.mode === 'stun')).toBe(true);
    expect(g.mode).toBe('down');
  });

  it('каждый удар этажа по герою — с меткой не короче 0,3 с', () => {
    const seen = new Set<number>();
    const bad: string[] = [];
    const watch = (s: Sim) => {
      for (const z of s.strikes) {
        if (seen.has(z.id)) continue;
        seen.add(z.id);
        if (z.dmg > 0 && z.warn < 0.3) bad.push(`${z.art}:${z.warn}`);
      }
    };
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 6.5, 16);
    for (const ph of [1, 2, 3])
      for (let t = 0; t < 20 * 60; t++) {
        s.hero.hp = s.stats.maxHp;
        const k = s.mobs.find((m) => m.kind === 'f13boss' && m.mode !== 'dying');
        if (k && k.mode !== 'rise' && s.boss!.phase < ph) k.hp = Math.min(k.hp, k.maxHp * (COL.hp[ph - 1] - 0.01));
        stepSim(s, DT, { ...NO_INPUT, mx: Math.cos(t / 90), my: Math.sin(t / 90) });
        watch(s);
      }
    for (const [area, x, y] of [
      [F13_OUTER, 31, 64],
      [F13_WALL, 31, 80],
      [F13_BELL, 21, 67],
    ] as [string, number, number][]) {
      const [wx, wy] = at(area, x, y);
      const s2 = sim(8, 5, wx + 0.5, wy + 0.5, 17);
      for (let t = 0; t < 40 * 60; t++) {
        s2.hero.hp = s2.stats.maxHp;
        stepSim(s2, DT, NO_INPUT);
        watch(s2);
      }
    }
    expect(bad).toEqual([]);
    expect(seen.size).toBeGreaterThan(20);
  });

  it('монстры не застревают в стенах', () => {
    const kinds = [
      'f13_walker',
      'f13_abnormal',
      'f13_thrower',
      'f13_armored',
      'f13_crystal',
      'f13_climber',
      'f13_crawler',
      'f13_grin',
      'f13_smuggler',
    ];
    const spots: [string, number, number][] = [
      [F13_OUTER, 31, 64],
      [F13_OUTER, 30, 20],
      [F13_WALL, 31, 80],
      [F13_BELL, 31, 94],
    ];
    const stuck: string[] = [];
    for (const [area, x, y] of spots) {
      const [wx, wy] = at(area, x, y);
      const s = sim(8, 5, wx + 0.5, wy + 3.5, 18);
      s.god = true;
      s.mobs = [];
      kinds.forEach((k, i) =>
        spawnMob(s, k, wx + 0.5 + ((i % 3) - 1) * 2.5, wy + 0.5 - Math.floor(i / 3) * 2.2, { mode: 'chase' }),
      );
      const bt: BotState = { lastAtk: -9, react: [0.25, 0.4], miss: 0.1, seed: 18, hooks: 0, cannons: 0 };
      for (let t = 0; t < 25 * 60; t++) {
        stepSim(s, DT, t % 30 < 15 ? bot(s, bt) : NO_INPUT);
        if (t % 30 !== 0) continue;
        for (const m of s.mobs) {
          if (m.mode === 'dying' || (m.data.ghost ?? 0) > 0) continue;
          if (['climb', 'zip', 'air', 'swoop', 'circle', 'flee', 'down', 'emerge'].includes(m.mode)) continue;
          const tile = s.tiles[Math.floor(m.y) * W + Math.floor(m.x)];
          if (!walkableTile(tile)) stuck.push(`${m.kind}@${area}:${m.mode}`);
        }
      }
    }
    if (LOG) console.log('застряли', stuck.join(' '));
    expect(stuck.slice(0, 8)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Дорога: от лифта до ворот площади Колосса пешком (крюки не в счёт).
// ---------------------------------------------------------------------------

describe('этаж 13: дорога', () => {
  it('лифт → ворота площади Колосса проходимы на Т8+5 с едой', () => {
    const lift = world.objs.find((o) => o.kind === 'lift' && o.area === F13_OUTER)!;
    const probe = sim(8, 5, 1, 1, 1);
    const gate = probe.boss!.gates[0];
    const gx = gate % W;
    const gy = Math.floor(gate / W) + 2;
    const f = field(gx, gy);
    expect(f[(lift.y + 1) * W + lift.x]).toBeGreaterThan(0);
    const s = sim(8, 5, lift.x + 0.5, lift.y + 1.5, 21, 8);
    const st: BotState = {
      lastAtk: -9,
      react: [0.22, 0.45],
      miss: 0.12,
      seed: 21,
      hooks: 0,
      cannons: 0,
      goal: { f, x: gx, y: gy },
    };
    let reached = -1;
    let dead = false;
    let best = f[Math.floor(s.hero.y) * W + Math.floor(s.hero.x)];
    const hurt = new Map<string, number>();
    for (let t = 0; t < 20 * 60 * 60; t++) {
      stepSim(s, DT, bot(s, st));
      let art = '';
      for (const e of s.events) if (e.t === 'strike') art = e.art;
      for (const e of s.events) if (e.t === 'hurt') hurt.set(art || 'иное', (hurt.get(art || 'иное') ?? 0) + e.dmg);
      if (s.hero.mode === 'dead') {
        dead = true;
        break;
      }
      const cur = f[Math.floor(s.hero.y) * W + Math.floor(s.hero.x)];
      if (cur >= 0) best = Math.min(best, cur);
      if (Math.hypot(gx + 0.5 - s.hero.x, gy + 0.5 - s.hero.y) < 1.2) {
        reached = s.time;
        break;
      }
    }
    if (LOG)
      console.log(
        `дорога: ${reached > 0 ? `дошёл за ${reached.toFixed(0)} с` : `не дошёл (${s.time.toFixed(0)} с, осталось ${best})`}, смерть ${dead}, убито ${s.killed}, мяса ${JSON.stringify(s.sack.meat)}, где ${s.hero.x.toFixed(0)},${s.hero.y.toFixed(0)} ${world.rowArea[Math.floor(s.hero.y)]}`,
        [...hurt].map(([a, v]) => `${a}:${v}`).join(' '),
        s.mobs.map((m) => `${m.kind}:${m.mode}`).join(' '),
      );
    expect(dead).toBe(false);
    expect(reached).toBeGreaterThan(0);
  });
});
