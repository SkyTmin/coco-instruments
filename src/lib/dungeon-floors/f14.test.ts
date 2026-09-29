// Этаж 14 «Часовая башня»: бот против Повелителя часа, выход с арены, путь
// от лифта до ворот, и механики — колокол «ЧАС», маятники, отмотчик и его
// якорь, солдатик со спины, перевёрнутые часы, зал отмотки, Стоп-кадр,
// Полдень, ножи остановки со сквозным проёмом, отмотка босса.
//
// Бот — живой игрок средней руки: видит метки на полу и уходит из них
// рывком за миг до удара (с задержкой реакции и изредка проглядев), ест,
// когда здоровья меньше 40%. Против Повелителя: после остановки уходит
// сквозным проёмом в кольце ножей или рывком, в полночь бежит в ступицу,
// в окна (стрелка в полу, отмотка, разбитые часы, выдохся) бьёт его.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, Tile, walkableTile } from '../dungeon-world';
import {
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
import {
  F14_FX,
  f14Flood,
  f14State,
  f14Time,
  KNIFE_ANG,
  LORD,
  NOON,
  REWIND,
  worldStopped,
} from './f14-brains';
import { F14_DIAL, F14_GEO, F14_MECH } from './f14';

const world = buildWorld(14);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F14LOG;
const TAU = Math.PI * 2;

const band = (id: string) => world.bands.find((b) => b.def.id === id)!;
const geo = (g: { area: string; x: number; y: number }): [number, number] => [
  g.x,
  band(g.area).top + g.y,
];

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 14 };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7, meat = 0): Sim {
  const d = dungeon(tier, plus);
  const s = createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
  if (meat) {
    s.sack.meat.f14_egg = meat;
    s.sack.meatBy[F14_DIAL] = meat;
  }
  return s;
}

/** Ближайшая к точке клетка пола. */
function floorNear(x: number, y: number): [number, number] {
  for (let r = 0; r < 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const i = Math.floor(y + dy) * W + Math.floor(x + dx);
        if (world.tiles[i] === Tile.Floor)
          return [Math.floor(x + dx) + 0.5, Math.floor(y + dy) + 0.5];
      }
  throw new Error(`нет пола у ${x},${y}`);
}

/** Шагать `secs` секунд одним вводом. */
function run(s: Sim, secs: number, inp: SimInput | ((s: Sim) => SimInput) = NO_INPUT): void {
  for (let t = 0; t < secs * 60; t++) stepSim(s, DT, typeof inp === 'function' ? inp(s) : inp);
}

const saw = (s: Sim, what: string) => s.events.some((e) => e.t === 'boss' && e.what === what);

interface BotState {
  lastAtk: number;
  react: [number, number];
  miss: number;
  seed: number;
  seen?: Map<string, [number, boolean]>;
  knifeAt?: Map<number, number>;
  lane?: { ang: number; key: number };
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
const [AX, AY] = geo(F14_GEO.arena);

const OPEN = ['f14_stuck', 'f14_broken', 'f14_tired', 'f14_ritual'];

function bot(s: Sim, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  const b = s.boss;
  if (worldStopped(s)) return inp;

  // Двенадцатый удар: в ступицу, что бы ни было.
  for (const z of s.strikes) {
    if (z.art !== 'f14_midnight') continue;
    const [react, missed] = notice(st, `mid${z.id}`);
    if (z.t < react * (missed ? 2.5 : 1)) break;
    const dx = z.x - h.x;
    const dy = z.y - h.y;
    const l = Math.hypot(dx, dy);
    if (l > 0.6) {
      inp.mx = dx / l;
      inp.my = dy / l;
      if (l > 3 && h.dashCd <= 0) inp.dash = true;
    }
    return inp;
  }

  // Ножи остановки висят кольцом: уйти сквозным проёмом и держаться его,
  // пока ножи летят (линии ножей проходят через центр — луч проёма их не
  // пересекает).
  const hang = s.shots.filter(
    (q) => KNIFE_ANG.has(q.id) && q.vx === 0 && q.vy === 0 && Math.hypot(q.x - h.x, q.y - h.y) < 5,
  );
  if (hang.length >= 4) {
    st.knifeAt ??= new Map();
    const key = hang[0].id;
    if (!st.knifeAt.has(key)) st.knifeAt.set(key, s.time);
    const [react, missed] = notice(st, `k${key}`);
    if (!missed && s.time - st.knifeAt.get(key)! >= react * 0.6) {
      const angs = hang.map((q) => Math.atan2(q.y - h.y, q.x - h.x)).sort((a, c) => a - c);
      let best = 0;
      let mid = 0;
      for (let i = 0; i < angs.length; i++) {
        const c = i + 1 < angs.length ? angs[i + 1] : angs[0] + TAU;
        if (c - angs[i] > best) {
          best = c - angs[i];
          mid = (angs[i] + c) / 2;
        }
      }
      // Из двух концов сквозного проёма — тот, что дальше от стен.
      const room = (a: number) => {
        let d = 0;
        while (
          d < 4 &&
          walkableTile(
            s.tiles[Math.floor(h.y + Math.sin(a) * d) * W + Math.floor(h.x + Math.cos(a) * d)],
          )
        )
          d += 0.25;
        return d;
      };
      if (room(mid + Math.PI) > room(mid) + 0.5) mid += Math.PI;
      st.lane = { ang: mid, key };
      inp.mx = Math.cos(mid);
      inp.my = Math.sin(mid);
      return inp;
    }
  }
  const flying = s.shots.filter(
    (q) =>
      KNIFE_ANG.has(q.id) && (q.vx !== 0 || q.vy !== 0) && Math.hypot(q.x - h.x, q.y - h.y) < 7,
  );
  // Летящий нож вот-вот попадёт — рывок поперёк.
  for (const q of flying) {
    const sp = Math.hypot(q.vx, q.vy);
    const rx = h.x - q.x;
    const ry = h.y - q.y;
    const along = (rx * q.vx + ry * q.vy) / sp;
    const across = Math.abs(rx * q.vy - ry * q.vx) / sp;
    if (along < -0.2 || along / sp > 0.2 || across > q.r + h.r + 0.1) continue;
    const [, missed] = notice(st, `kf${q.id}`);
    if (missed || h.dashCd > 0) continue;
    const side = rx * q.vy - ry * q.vx >= 0 ? 1 : -1;
    inp.mx = (q.vy / sp) * side;
    inp.my = (-q.vx / sp) * side;
    inp.dash = true;
    return inp;
  }
  if (flying.length && st.lane) {
    inp.mx = Math.cos(st.lane.ang);
    inp.my = Math.sin(st.lane.ang);
    return inp;
  }
  if (!flying.length && !hang.length) st.lane = undefined;

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
  // Линии прицела (минутная стрелка, штык, клюв) — вбок.
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
  // Стрелки арены в полночь: подходит — рывок сквозь неё, против хода.
  const arms = F14_FX.hands.arena;
  if (b?.state === 'fight' && b.phase >= 3 && arms.on) {
    const dx = h.x - AX;
    const dy = h.y - AY;
    const r = Math.hypot(dx, dy);
    const ha = Math.atan2(dx, -dy);
    for (const [ang, len, w] of [
      [arms.m, 9.6, TAU / 6.4],
      [arms.h, 6.2, TAU / 38],
    ] as const) {
      if (r < NOON.hub - h.r || r > len + h.r) continue;
      const diff = (((ha - ang) % TAU) + TAU) % TAU;
      const tt = (diff - (NOON.w + h.r + 0.2) / Math.max(1, r)) / w;
      if (tt > 0.3 || tt < -0.05) continue;
      const [, missed] = notice(st, `h${len}:${Math.round(s.time * 2)}`);
      if (missed || h.dashCd > 0) continue;
      inp.mx = -Math.cos(ha);
      inp.my = -Math.sin(ha);
      inp.dash = true;
      return inp;
    }
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
  const meat = Object.values(s.sack.meat).reduce<number>((a, c) => a + (c ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) inp.eat = true;

  // Цель: Повелитель в окне — прежде всего; иначе ближний.
  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || (m.data.ghost ?? 0) > 0) continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const w = m.kind === 'f14boss' && OPEN.includes(m.mode) ? d - 8 : d;
    if (w < nd) {
      nd = w;
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
  return inp;
}

interface Fight {
  won: number;
  s: Sim;
  phases: number;
  low: number;
}

/** Откуда пришёл урон (для подбора): по тому, что творится в кадре. */
function blame(s: Sim, lord: Mob | undefined): string {
  if (s.strikes.some((z) => z.art === 'f14_midnight' && z.t >= z.warn - 0.05)) return 'полночь';
  if (
    s.shots.some(
      (q) =>
        KNIFE_ANG.has(q.id) && (q.vx || q.vy) && Math.hypot(q.x - s.hero.x, q.y - s.hero.y) < 1,
    )
  )
    return 'нож';
  if (lord && ['f14_minute', 'f14_lunge'].includes(lord.mode)) return 'минутная';
  if (lord && lord.mode === 'recover' && lord.data.lit === 0) return 'стрелка/кольцо';
  if (F14_FX.hands.arena.on) return 'стрелки арены/прочее';
  return lord ? `Повелитель:${lord.mode}` : 'прочее';
}

function fight(tier: number, plus: number, seed: number, meat = 4): Fight {
  const s = sim(tier, plus, bossObj.x + 0.5, bossObj.y + 7.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.22, 0.45], miss: 0.12, seed };
  let won = -1;
  let phases = 0;
  let low = 1;
  const modes = new Map<string, number>();
  const hurt = new Map<string, number>();
  let eaten = 0;
  let dbg = 0;
  let lordK = 1;
  for (let t = 0; t < 480 * 60; t++) {
    stepSim(s, DT, bot(s, st));
    low = Math.min(low, s.hero.hp / s.stats.maxHp);
    const k = s.mobs.find((m) => m.kind === 'f14boss');
    if (k) modes.set(k.mode, (modes.get(k.mode) ?? 0) + DT);
    if (k) lordK = k.hp / k.maxHp;
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'phase') phases += 1;
      if (e.t === 'eat') eaten += 1;
      if (e.t === 'hurt' && LOG) {
        const w = blame(s, k);
        hurt.set(w, (hurt.get(w) ?? 0) + e.dmg);
        if (process.env.F14DBG && dbg++ < 40)
          console.log(
            `${s.time.toFixed(2)} ${w} -${Math.round((100 * e.dmg) / s.stats.maxHp)}% hero ${s.hero.mode} cd${s.hero.dashCd.toFixed(2)} lord ${k?.mode}@${k?.t.toFixed(2)} d${k ? Math.hypot(k.x - s.hero.x, k.y - s.hero.y).toFixed(1) : '-'} strikes ${s.strikes.map((z) => `${z.art}:${z.t.toFixed(2)}/${z.warn.toFixed(2)}`).join(',')} mobs ${s.mobs
              .filter((m) => m.kind !== 'f14boss' && Math.hypot(m.x - s.hero.x, m.y - s.hero.y) < 6)
              .map(
                (m) =>
                  `${m.kind}:${m.mode}@${Math.hypot(m.x - s.hero.x, m.y - s.hero.y).toFixed(1)}`,
              )
              .join(',')} shots ${s.shots
              .filter((q) => Math.hypot(q.x - s.hero.x, q.y - s.hero.y) < 2)
              .map((q) => q.art)
              .join(',')} zones ${s.zones
              .filter((z) => Math.hypot(z.x - s.hero.x, z.y - s.hero.y) < z.r + 1)
              .map((z) => z.art)
              .join(',')} hp ${s.hero.hp.toFixed(0)}/${s.stats.maxHp}`,
          );
      }
    }
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  if (LOG) {
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фаз ${phases}, Повелитель ${Math.round(100 * lordK)}%, минимум здоровья ${Math.round(low * 100)}%, съел ${eaten}\n  режимы: ${[...modes].map(([m, v]) => `${m}:${v.toFixed(0)}`).join(' ')}\n  урон: ${[...hurt].map(([m, v]) => `${m}:${Math.round((100 * v) / s.stats.maxHp)}%`).join(' ')}`,
    );
  }
  return { won, s, phases, low };
}

describe('этаж 14: Повелитель часа', () => {
  it('на Т8+5 с едой бот побеждает за 2–6 минут, проходя все фазы', () => {
    const res = [41, 42, 43, 44].map((seed) => fight(8, 5, seed));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(120);
      expect(r.won).toBeLessThan(360);
      expect(r.phases).toBe(3);
    }
    // Не прогулка: хоть раз доводит бота до края или побеждает.
    expect(res.some((r) => r.won < 0 || r.low < 0.45)).toBe(true);
  });

  it('на Т8+0 без еды — смерть чаще победы', () => {
    const res = [51, 52, 53].map((seed) => fight(8, 0, seed, 0).won);
    expect(res.filter((t) => t > 0).length).toBeLessThanOrEqual(1);
  });
});

describe.runIf(!!process.env.F14SWEEP)('этаж 14: подбор', () => {
  it('сетка снаряжения', () => {
    for (const [tier, plus, meat] of (process.env.F14SWEEP ?? '')
      .split(';')
      .map((x) => x.split(',').map(Number)))
      for (const seed of [61, 62, 63]) fight(tier, plus, seed, meat);
  });
});

// ---------------------------------------------------------------------------
// Арена и дорога к ней.
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

describe('этаж 14: арена-циферблат', () => {
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

  it('от лифта до ворот арены — дорога есть, живой бот доходит; у Преддверия — свой лифт', () => {
    const entry = world.objs.find((o) => o.kind === 'lift' && o.area === F14_MECH)!;
    const old = world.objs.find((o) => o.kind === 'lift' && o.area === F14_DIAL)!;
    expect(entry).toBeTruthy();
    expect(old).toBeTruthy();
    const probe = sim(8, 5, entry.x + 0.5, entry.y + 1.5, 3);
    const gate = probe.boss!.gates[0];
    expect(probe.boss!.cells.has(old.y * W + old.x)).toBe(false);
    const f = field(gate % W, Math.floor(gate / W));
    for (const l of [entry, old]) expect(f[(l.y + 1) * W + l.x]).toBeGreaterThan(0);
    // По живому миру от входа: без мобов, но с колоколом, маятниками,
    // шестернями, песком и стрелками Полдня.
    const s = sim(8, 5, entry.x + 0.5, entry.y + 1.5, 3);
    // Живой игрок обходит тумбы и колонны: их клетки — не дорога.
    const tiles = Uint8Array.from(world.tiles);
    for (const p of s.props)
      if (p.alive && p.r >= 0.3) tiles[Math.floor(p.y) * W + Math.floor(p.x)] = Tile.Wall;
    const fl = field(gate % W, Math.floor(gate / W), tiles);
    const h = s.hero;
    let arrived = -1;
    for (let t = 0; t < 600 * 60; t++) {
      s.mobs = s.mobs.filter((m) => m.mode === 'f14_frozen' || m.mode === 'f14_statue');
      h.hp = s.stats.maxHp;
      stepSim(s, DT, follow(s, fl, gate % W, Math.floor(gate / W)));
      if (Math.hypot((gate % W) + 0.5 - h.x, Math.floor(gate / W) + 0.5 - h.y) < 1.2) {
        arrived = s.time;
        break;
      }
    }
    if (LOG) {
      const b = world.bands.find((q) => h.y >= q.top && h.y < q.top + q.h)!;
      console.log(
        `от лифта до ворот: ${arrived.toFixed(0)} с; стоит в ${b.def.id} ${h.x.toFixed(1)},${(h.y - b.top).toFixed(1)} поле ${f[Math.floor(h.y) * W + Math.floor(h.x)]}`,
      );
      for (let y = Math.floor(h.y) - 4; y <= Math.floor(h.y) + 4; y++) {
        let row = '';
        for (let x = Math.floor(h.x) - 8; x <= Math.floor(h.x) + 8; x++) {
          const t = s.tiles[y * W + x];
          const pr = s.props.find(
            (p) => p.alive && Math.floor(p.x) === x && Math.floor(p.y) === y && p.r > 0,
          );
          row +=
            x === Math.floor(h.x) && y === Math.floor(h.y)
              ? '@'
              : pr
                ? 'o'
                : walkableTile(t)
                  ? '.'
                  : t === Tile.Wall
                    ? '#'
                    : String(t % 10);
        }
        console.log('  ' + row);
      }
    }
    expect(arrived).toBeGreaterThan(0);
  });

  it('посты (солдатики, гири) стоят на проходимых клетках, кукушки — в стенах', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 7.5, 2);
    stepSim(s, DT, NO_INPUT);
    const st = f14State(s)!;
    expect(st.posts.length).toBeGreaterThan(10);
    for (const p of st.posts) {
      const t = world.tiles[Math.floor(p.y) * W + Math.floor(p.x)];
      expect(walkableTile(t)).toBe(true);
      // Кукушка живёт в часах на стене над своим постом.
      if (p.kind === 'f14_cuckoo')
        expect(walkableTile(world.tiles[Math.floor(p.y - 1.2) * W + Math.floor(p.x)])).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Механики.
// ---------------------------------------------------------------------------

/** Шагать и собрать слова событий. */
function runEv(
  s: Sim,
  secs: number,
  inp: SimInput | ((s: Sim) => SimInput) = NO_INPUT,
): Set<string> {
  const out = new Set<string>();
  for (let t = 0; t < secs * 60; t++) {
    stepSim(s, DT, typeof inp === 'function' ? inp(s) : inp);
    for (const e of s.events) if (e.t === 'boss') out.add(e.what);
  }
  return out;
}

/** Бессмертный герой: тесты — про механику, а не про выживание. */
const immortal = (s: Sim) => {
  s.hero.hp = s.stats.maxHp;
};
const still = (s: Sim) => {
  immortal(s);
  return NO_INPUT;
};

describe('этаж 14: время', () => {
  it('колокол «ЧАС»: за три секунды предупреждает, потом мир стоит, а герой ходит', () => {
    const [x, y] = floorNear(...geo({ area: F14_MECH, x: 32, y: 50 }));
    const s = sim(8, 5, x, y, 4);
    stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    const m = spawnMob(s, 'f14_beetle', x + 3, y);
    const T = f14Time(s)!;
    T.bellT = 3.1;
    const ev = runEv(s, 0.3);
    expect(ev.has('f14_bell_call')).toBe(true);
    expect(worldStopped(s)).toBe(false);
    // «Вдох» — за две секунды до удара: звук остановки ложится на удар.
    let windAt = -1;
    let bellAt = -1;
    for (let t = 0; t < 3 * 60 && bellAt < 0; t++) {
      // Укусы жука дают стоп-кадр удара — он растягивал бы замер.
      s.hero.inv = 1;
      stepSim(s, DT, NO_INPUT);
      if (saw(s, 'f14_bell_wind')) windAt = t * DT;
      if (saw(s, 'f14_bell')) bellAt = t * DT;
    }
    expect(windAt).toBeGreaterThanOrEqual(0);
    expect(bellAt - windAt).toBeGreaterThan(1.9);
    expect(bellAt - windAt).toBeLessThan(2.1);
    expect(worldStopped(s)).toBe(true);
    const mx = m.x;
    const hx = s.hero.x;
    const t0 = s.time;
    run(s, 0.8, { ...NO_INPUT, mx: -1 });
    expect(Math.abs(m.x - mx)).toBeLessThan(0.01);
    expect(s.time - t0).toBeLessThan(0.01);
    expect(hx - s.hero.x).toBeGreaterThan(1.5);
    const ev3 = runEv(s, 2);
    expect(ev3.has('f14_resume')).toBe(true);
    expect(worldStopped(s)).toBe(false);
  });

  it('маятник бьёт того, кто стоит на его пути', () => {
    const s0 = sim(8, 5, 5, 5, 1);
    stepSim(s0, DT, NO_INPUT);
    const pends = f14State(s0)!.pends;
    expect(pends.length).toBeGreaterThanOrEqual(4);
    const p = pends[0];
    const s = sim(8, 5, p.x, p.y, 5);
    let hit = false;
    for (let t = 0; t < p.period * 1.5 * 60 && !hit; t++) {
      s.mobs = [];
      stepSim(s, DT, NO_INPUT);
      hit = s.events.some((e) => e.t === 'boss' && e.what === 'f14_pend');
    }
    expect(hit).toBe(true);
    expect(s.hero.hp).toBeLessThan(s.stats.maxHp);
  });

  it('отмотчик: ранен — через полсекунды улетает в своё прошлое и лечится; герой на якоре — срывает', () => {
    const [x, y] = floorNear(...geo({ area: F14_DIAL, x: 32, y: 86 }));
    for (const onAnchor of [false, true]) {
      const s = sim(8, 5, x, y, 6);
      stepSim(s, DT, NO_INPUT);
      s.mobs = [];
      const m = spawnMob(s, 'f14_rewinder', x + 5, y);
      // Идёт к герою три секунды — пишет своё прошлое.
      for (let t = 0; t < 3.2 * 60; t++) {
        immortal(s);
        s.hero.inv = 1;
        stepSim(s, DT, NO_INPUT);
      }
      expect(Math.hypot(m.x - s.hero.x, m.y - s.hero.y)).toBeLessThan(2.5);
      s.hero.inv = 0;
      for (let t = 0; t < 90 && m.data.rwAt === undefined; t++)
        stepSim(s, DT, {
          ...NO_INPUT,
          attack: true,
          aim: { x: m.x - s.hero.x, y: m.y - s.hero.y },
        });
      expect(m.data.rwAt).toBeDefined();
      const ax = m.data.ax!;
      const ay = m.data.ay!;
      expect(Math.hypot(ax - m.x, ay - m.y)).toBeGreaterThan(1.5);
      if (onAnchor) {
        s.hero.x = ax;
        s.hero.y = ay;
      }
      const hurt = m.hp;
      const ev = runEv(s, REWIND.window + REWIND.fly + 0.1, (q) => {
        immortal(q);
        q.hero.inv = 1;
        return NO_INPUT;
      });
      if (onAnchor) {
        expect(ev.has('f14_anchor_stone')).toBe(true);
        expect(m.mode).toBe('f14_dazed');
      } else {
        expect(ev.has('f14_rewind')).toBe(true);
        expect(Math.hypot(m.x - ax, m.y - ay)).toBeLessThan(1.2);
        expect(m.hp).toBeGreaterThan(hurt);
      }
    }
  });

  it('солдатик: удар в спину — по ключу — сразу снимает завод, в лицо — нет', () => {
    const [x, y] = floorNear(...geo({ area: F14_MECH, x: 32, y: 50 }));
    for (const behind of [true, false]) {
      const s = sim(8, 5, x, y, 8);
      stepSim(s, DT, NO_INPUT);
      s.mobs = [];
      const m = spawnMob(s, 'f14_soldier', x + 1, y);
      m.mode = 'aim';
      m.t = 0;
      m.dir = behind ? 0 : Math.PI;
      m.face = m.dir;
      m.data.wind = 1;
      for (let t = 0; t < 30 && m.hp === m.maxHp; t++) {
        immortal(s);
        stepSim(s, DT, { ...NO_INPUT, attack: true, aim: { x: 1, y: 0 } });
      }
      expect(m.hp).toBeLessThan(m.maxHp);
      if (behind) expect(m.mode).toBe('f14_unwound');
      else expect(m.mode).not.toBe('f14_unwound');
    }
  });

  it('перевёрнутые часы: песок поднимается, малые часы держат его, ушёл вверх — сходит', () => {
    const s0 = sim(8, 5, 5, 5, 1);
    stepSim(s0, DT, NO_INPUT);
    const fl0 = f14Flood(s0)!;
    const [x, y] = floorNear(fl0.cx, fl0.bottom - 3);
    const s = sim(8, 5, x, y, 9);
    s.mobs = [];
    const ev = runEv(s, 0.5, (q) => {
      q.mobs = [];
      return still(q);
    });
    const fl = f14Flood(s)!;
    expect(ev.has('f14_flip_trap')).toBe(true);
    expect(fl.state).toBe('rise');
    const f0 = fl.front;
    run(s, 1.5, still);
    expect(fl.front).toBeLessThan(f0 - 1);
    // Малые часы: подойти и перевернуть.
    const glass = s.props.find((p) => p.obj.ref === 'f14_glass')!;
    s.hero.x = glass.obj.x + 0.5;
    s.hero.y = glass.obj.y + 1.2;
    const u = usableNear(s);
    expect(u?.label).toBe('Перевернуть');
    expect(useObject(s, u!)).toBe(true);
    const f1 = fl.front;
    run(s, 3, still);
    expect(Math.abs(fl.front - f1)).toBeLessThan(0.01);
    // Выбрался наверх — песок уходит.
    const [ux, uy] = floorNear(fl.cx, fl.top - 3);
    s.hero.x = ux;
    s.hero.y = uy;
    run(s, 12, (q) => {
      q.mobs = [];
      q.hero.x = ux;
      q.hero.y = uy;
      return still(q);
    });
    expect(fl.state).toBe('idle');
  });

  it('зал отмотки: решётки падают, павшие встают, пока целы якоря; разбил — зал отдаёт своё', () => {
    const s0 = sim(8, 5, 5, 5, 1);
    stepSim(s0, DT, NO_INPUT);
    const r0 = f14State(s0)!.rewind!;
    const [x, y] = floorNear((r0.box[0] + r0.box[2]) / 2 + 0.5, (r0.box[1] + r0.box[3]) / 2 + 0.5);
    const s = sim(8, 5, x, y, 10);
    s.mobs = [];
    const ev = runEv(s, 0.3, still);
    const r = f14State(s)!.rewind!;
    expect(ev.has('f14_rewind_trap')).toBe(true);
    for (const i of r.bars) expect(walkableTile(s.tiles[i])).toBe(false);
    const kill = () => {
      for (const m of s.mobs)
        if (r.mobs.has(m.id) && m.mode !== 'dying') {
          m.hp = 0;
          m.mode = 'dying';
          m.t = 0;
        }
    };
    run(s, 1.5, still);
    kill();
    run(s, 0.1, still);
    const fallen = r.dead.length;
    expect(fallen).toBeGreaterThan(0);
    r.t = 0.05;
    const ev2 = runEv(s, 1.8, still);
    expect(ev2.has('f14_flipback')).toBe(true);
    expect(
      s.mobs.filter((m) => r.mobs.has(m.id) && m.mode !== 'dying').length,
    ).toBeGreaterThanOrEqual(fallen);
    // Якоря разбиты — павшие больше не встают; добил всех — решётки поднялись.
    for (const a of r.anchors) a.alive = false;
    const ev3 = new Set<string>();
    for (let k = 0; k < 20 && r.state !== 'done'; k++) {
      kill();
      for (const w of runEv(s, 0.5, still)) ev3.add(w);
    }
    expect(r.state).toBe('done');
    expect(ev3.has('f14_rewind_done')).toBe(true);
    for (const i of r.bars) expect(walkableTile(s.tiles[i])).toBe(true);
  });

  it('Стоп-кадр: ножи висят и враги замерли, пока не шагнёшь в середину; через три секунды всё летит', () => {
    const s0 = sim(8, 5, 5, 5, 1);
    stepSim(s0, DT, NO_INPUT);
    const fr0 = f14State(s0)!.frame!;
    const cx = (fr0.box[0] + fr0.box[2] + 1) / 2;
    const [x, y] = floorNear(cx, fr0.box[3] + 3);
    const s = sim(8, 5, x, y, 11);
    stepSim(s, DT, NO_INPUT);
    const fr = f14State(s)!.frame!;
    expect(fr.state).toBe('still');
    const frozen = s.mobs.filter((m) => fr.mobs.has(m.id));
    expect(frozen.length).toBeGreaterThanOrEqual(4);
    const pos = frozen.map((m) => [m.x, m.y]);
    run(s, 3, still);
    frozen.forEach((m, i) =>
      expect(Math.hypot(m.x - pos[i][0], m.y - pos[i][1])).toBeLessThan(0.05),
    );
    expect(frozen.every((m) => m.mode === 'f14_frozen')).toBe(true);
    const knives = s.shots.filter((q) => fr.knives.some((k) => k.id === q.id));
    expect(knives.length).toBeGreaterThanOrEqual(4);
    expect(knives.every((q) => q.vx === 0 && q.vy === 0)).toBe(true);
    // В середину — отсчёт, потом ножи летят и враги оживают.
    const [mx, my] = floorNear(cx, fr.mid + 1);
    s.hero.x = mx;
    s.hero.y = my;
    const ev = runEv(s, 0.3, still);
    expect(ev.has('f14_frame_call')).toBe(true);
    const ev2 = runEv(s, 3, still);
    expect(ev2.has('f14_resume')).toBe(true);
    expect(frozen.filter((m) => m.mode !== 'dying').every((m) => m.mode !== 'f14_frozen')).toBe(
      true,
    );
  });

  it('Полдень: стрелки метут площадь и бьют; в ступице безопасно', () => {
    const s0 = sim(8, 5, 5, 5, 1);
    stepSim(s0, DT, NO_INPUT);
    const pz = f14State(s0)!.plaza!;
    const [x, y] = floorNear(pz.cx + 6, pz.cy);
    const s = sim(8, 5, x, y, 12);
    const ev = runEv(s, NOON.minPeriod * 1.2, (q) => {
      q.mobs = [];
      q.hero.x = x;
      q.hero.y = y;
      return still(q);
    });
    expect(ev.has('f14_noon_call')).toBe(true);
    expect(ev.has('f14_handhit')).toBe(true);
    // Ступица: ни одна стрелка не достаёт.
    let hx = pz.cx;
    let hy = pz.cy;
    if (!walkableTile(world.tiles[Math.floor(hy) * W + Math.floor(hx)]))
      [hx, hy] = floorNear(hx, hy);
    expect(Math.hypot(hx - pz.cx, hy - pz.cy)).toBeLessThan(NOON.hub - 0.3);
    const ev2 = runEv(s, NOON.minPeriod * 1.2, (q) => {
      q.mobs = [];
      q.hero.x = hx;
      q.hero.y = hy;
      return still(q);
    });
    expect(ev2.has('f14_handhit')).toBe(false);
  });
});

describe('этаж 14: Повелитель часа — приёмы', () => {
  /** Бой без бота: герой бессмертен и стоит, Повелитель — на доле здоровья. */
  function lordAt(k: number, seed: number) {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 7.5, seed);
    run(s, 0.6, still);
    const lord = s.mobs.find((m) => m.kind === 'f14boss')!;
    lord.hp = lord.maxHp * k;
    return { s, lord };
  }

  it('остановка: ножи кольцом со СКВОЗНЫМ проёмом — луч проёма не пересекает ни одна линия ножа', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { s } = lordAt(0.7, seed);
      let found = false;
      let clapAt = -1;
      let stopAt = -1;
      for (let t = 0; t < 40 * 60 && !found; t++) {
        immortal(s);
        stepSim(s, DT, NO_INPUT);
        if (saw(s, 'f14_clap')) clapAt = t * DT;
        if (saw(s, 'f14_stop')) stopAt = t * DT;
        found = s.events.some((e) => e.t === 'boss' && e.what === 'f14_knives');
      }
      expect(found).toBe(true);
      // Хлопок — две секунды замаха: под него «вдох» звука остановки.
      expect(Math.abs(stopAt - clapAt - LORD.clap)).toBeLessThan(0.1);
      const h = s.hero;
      const ks = s.shots.filter((q) => KNIFE_ANG.has(q.id) && q.vx === 0 && q.vy === 0);
      expect(ks.length).toBeGreaterThanOrEqual(LORD.knives - 3);
      // Проём: самая широкая щель между ножами.
      const angs = ks.map((q) => Math.atan2(q.y - h.y, q.x - h.x)).sort((a, c) => a - c);
      let best = 0;
      let mid = 0;
      angs.forEach((a, i) => {
        const c = i + 1 < angs.length ? angs[i + 1] : angs[0] + TAU;
        if (c - a > best) {
          best = c - a;
          mid = (a + c) / 2;
        }
      });
      for (const d of [1.5, 2.5])
        for (const dir of [mid, mid + Math.PI]) {
          const px = h.x + Math.cos(dir) * d;
          const py = h.y + Math.sin(dir) * d;
          if (!walkableTile(s.tiles[Math.floor(py) * W + Math.floor(px)])) continue;
          for (const q of ks) {
            const a = KNIFE_ANG.get(q.id)!;
            const across = Math.abs((px - q.x) * Math.sin(a) - (py - q.y) * Math.cos(a));
            expect(across).toBeGreaterThan(q.r + h.r);
          }
        }
    }
  });

  it('отмотка: не снял порог — Повелитель возвращает здоровье; снял — часы разбиты, он открыт', () => {
    for (const cut of [false, true]) {
      const { s, lord } = lordAt(1, 21);
      run(s, 1, still);
      lord.hp = lord.maxHp * 0.49;
      for (let t = 0; t < 20 * 60 && lord.mode !== 'f14_ritual'; t++) {
        immortal(s);
        s.hero.inv = 1;
        stepSim(s, DT, NO_INPUT);
      }
      expect(lord.mode).toBe('f14_ritual');
      expect(s.boss!.phase).toBe(2);
      const hp0 = lord.hp;
      if (cut) lord.hp -= lord.maxHp * LORD.need + 1;
      let modeAt = '';
      const ev = runEv(s, LORD.ritual + 0.3, (q) => {
        q.hero.inv = 1;
        if (!modeAt && q.events.some((e) => e.t === 'boss' && e.what === 'f14_ritual_stone'))
          modeAt = lord.mode;
        return still(q);
      });
      if (cut) {
        expect(ev.has('f14_ritual_stone')).toBe(true);
        expect(modeAt).toBe('f14_broken');
      } else {
        expect(ev.has('f14_ritual')).toBe(true);
        expect(lord.hp).toBeGreaterThan(hp0 + lord.maxHp * 0.05);
      }
    }
  });
});
