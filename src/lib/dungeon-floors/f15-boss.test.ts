// Этаж 15, район «Ядро»: бот против Хозяина подземелья (все шесть фаз),
// выход с арены после победы, откат арены при смерти, механики — эхо по
// очереди и звёзды на плаще, колодцы тянут, планеты открывают лицо,
// четверти памяти с проходом к звезде, затмение с окном, сверхновая с
// выдохом, разворот владыки не быстрее `LORD.turn` и без хода боком.
//
// Бот — живой игрок средней руки (как у этажей 6–14): видит метки на полу
// и уходит из них рывком за миг до удара (с задержкой реакции, изредка
// проглядев), ест, когда здоровья меньше 40%, бьёт ближнюю открытую часть
// босса. `F15LOG=1` печатает ход боя.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, Tile, walkableTile } from '../dungeon-world';
import { API, createSim, NO_INPUT, stepSim, strikeHits, SWORD } from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import { BRAINS } from '../dungeon-ai';
import { ECHO, f15bForce, f15bView, LORD, QUADS } from './f15-boss-brains';
import { F15_HEART, F15_JOIN, F15B_GEO, F15B_MARK } from './f15-boss';
import { F15_MARK } from './f15';

const world = buildWorld(15);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F15LOG;
const MK = F15B_MARK;

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 15 };
}

const bossObj = world.objs.find((o) => o.kind === 'boss' && o.ref === 'f15boss')!;
const gateObj = world.objs
  .filter((o) => o.kind === 'gate')
  .sort(
    (a, b) =>
      Math.hypot(a.x - bossObj.x, a.y - bossObj.y) - Math.hypot(b.x - bossObj.x, b.y - bossObj.y),
  )[0];
const band = world.bands.find((b) => b.def.id === F15_HEART)!;
const STAR: [number, number] = [F15B_GEO.cx, F15B_GEO.cy + band.top];

function sim(tier: number, plus: number, x: number, y: number, seed = 7, meat = 0): Sim {
  const d = dungeon(tier, plus);
  const s = createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
  if (meat) {
    s.sack.meat.f10_heart = meat;
    s.sack.meatBy[F15_HEART] = meat;
  }
  return s;
}

interface BotState {
  lastAtk: number;
  react: [number, number];
  miss: number;
  seed: number;
  seen?: Map<string, [number, boolean]>;
  /** Застрял: где был секунду назад и до каких пор обходить. */
  px?: number;
  py?: number;
  pt?: number;
  side?: number;
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
    if (st.seen.size > 600) st.seen.clear();
  }
  return v;
}

const badCell = (s: Sim, x: number, y: number) => {
  const i = Math.floor(y) * W + Math.floor(x);
  const t = s.tiles[i];
  if (!walkableTile(t)) return true;
  const mk = s.world.mark[i];
  return mk === MK.crust || mk === MK.bog;
};

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Сверхновая: держаться в просвете между лучами у самой звезды. */
function novaMove(s: Sim, inp: SimInput): boolean {
  const v = f15bView(s);
  const nv = v?.nova;
  if (!v || !nv || nv.stage !== 'beams') return false;
  const h = s.hero;
  const a = Math.atan2(h.y - v.cy, h.x - v.cx);
  const step = (Math.PI * 2) / nv.n;
  // Середина ближнего просвета.
  let best = 0;
  let bd = 9;
  for (let i = 0; i < nv.n; i++) {
    const mid = nv.a + i * step + step / 2;
    const d = Math.abs(angDiff(mid, a));
    if (d < bd) {
      bd = d;
      best = mid;
    }
  }
  const tx = v.cx + Math.cos(best) * 2.4;
  const ty = v.cy + Math.sin(best) * 2.4;
  const l = Math.hypot(tx - h.x, ty - h.y);
  if (l > 0.35) {
    inp.mx = (tx - h.x) / l;
    inp.my = (ty - h.y) / l;
  }
  // Луч вот-вот коснётся — рывком сквозь него.
  const rh = Math.hypot(h.x - v.cx, h.y - v.cy);
  for (let i = 0; i < nv.n; i++) {
    const ba = nv.a + i * step;
    const ahead = angDiff(a, ba) * Math.sign(nv.spin) * rh;
    if (ahead > -0.2 && ahead < LORD.beamW + h.r + 0.35 && h.dashCd <= 0) {
      const t = ba - Math.sign(nv.spin) * (Math.PI / 2);
      inp.mx = Math.cos(t);
      inp.my = Math.sin(t);
      inp.dash = true;
      return true;
    }
  }
  // Лучи идут — от просвета не отходить (бить только то, что в досягаемости).
  return true;
}

function bot(s: Sim, st: BotState): SimInput {
  const inp = brain(s, st);
  const h = s.hero;
  // Упёрся (в стойку, в угол) — секунду обходит под прямым углом.
  if (st.pt === undefined || s.time - st.pt > 1) {
    const moved = Math.hypot(h.x - (st.px ?? h.x), h.y - (st.py ?? h.y));
    if (st.pt !== undefined && moved < 0.4 && Math.hypot(inp.mx, inp.my) > 0.5)
      st.side = s.time + 0.7;
    st.px = h.x;
    st.py = h.y;
    st.pt = s.time;
  }
  if ((st.side ?? 0) > s.time && !inp.dash) {
    // Середина арены открыта: оттуда дорога есть всегда.
    const l = Math.hypot(STAR[0] - h.x, STAR[1] + 2 - h.y) || 1;
    inp.mx = (STAR[0] - h.x) / l;
    inp.my = (STAR[1] + 2 - h.y) / l;
  }
  return inp;
}

function brain(s: Sim, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  const [cx, cy] = STAR;
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
    if (badCell(s, h.x + inp.mx * 2.2, h.y + inp.my * 2.2)) {
      inp.mx = -ay / l;
      inp.my = ax / l;
    }
    if (left < 0.22 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Линии прицела (клубок, таран, осколок) — вбок.
  for (const m of s.mobs) {
    let line: { r: number; w: number; ang: number } | null = null;
    if (m.tele && m.tele.shape === 'line')
      line = { r: m.tele.r, w: m.tele.w ?? 0.5, ang: m.tele.ang ?? 0 };
    if (m.kind === 'f15b_shard' && m.mode === 'f15s_aim')
      line = { r: 7.5, w: m.r + 0.1, ang: m.data.ang ?? 0 };
    if (!line) continue;
    const [react, missed] = notice(st, `l${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (missed || m.t < react) continue;
    const hit = strikeHits(
      { shape: 'line', x: m.x, y: m.y, r: line.r, w: line.w, ang: line.ang, warn: 1, dmg: 0 },
      h.x,
      h.y,
      h.r + 0.3,
    );
    if (!hit) continue;
    const a = line.ang + Math.PI / 2;
    const side = Math.cos(a) * (h.x - m.x) + Math.sin(a) * (h.y - m.y) >= 0 ? 1 : -1;
    inp.mx = Math.cos(a) * side;
    inp.my = Math.sin(a) * side;
    if ((m.danger > 0 || (m.kind === 'f15b_shard' && m.t > 0.55)) && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Летящий снаряд — вбок (рывком, если уже рядом).
  for (const sh of s.shots) {
    if (sh.lob) continue;
    const dx = h.x - sh.x;
    const dy = h.y - sh.y;
    const v = Math.hypot(sh.vx, sh.vy) || 1;
    const along = (dx * sh.vx + dy * sh.vy) / v;
    const across = Math.abs(dx * sh.vy - dy * sh.vx) / v;
    if (along < 0 || along > 3.2 || across > sh.r + h.r + 0.15) continue;
    const [react, missed] = notice(st, `f${sh.id}`);
    if (missed || sh.age < react) continue;
    const side = dx * sh.vy - dy * sh.vx >= 0 ? 1 : -1;
    inp.mx = (sh.vy / v) * side;
    inp.my = (-sh.vx / v) * side;
    if (along < 1.4 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Замах вплотную (эхо) — отскок.
  for (const m of s.mobs) {
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (m.mode !== 'windup') continue;
    const [react, missed] = notice(st, `w${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (!missed && m.t > react && d < MOBS[m.kind].reach + m.r + 1.2 && h.dashCd <= 0) {
      const away = Math.atan2(h.y - m.y, h.x - m.x) + 0.6;
      inp.mx = Math.cos(away);
      inp.my = Math.sin(away);
      inp.dash = true;
      return inp;
    }
  }
  // Жжёт или вязнет — к звезде.
  if (badCell(s, h.x, h.y)) {
    const l = Math.hypot(cx - h.x, cy + 2 - h.y) || 1;
    inp.mx = (cx - h.x) / l;
    inp.my = (cy + 2 - h.y) / l;
    return inp;
  }
  for (const z of s.zones) {
    if (!(z.dps || z.slow) || z.t < (z.warn ?? 0)) continue;
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d < z.r + h.r) {
      inp.mx = (h.x - z.x) / (d || 1);
      inp.my = (h.y - z.y) / (d || 1);
      return inp;
    }
  }
  const meat = Object.values(s.sack.meat).reduce<number>((a, c) => a + (c ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) inp.eat = true;
  const moving = novaMove(s, inp);

  // Цель: ближняя открытая часть босса (эхо, голова, владыка), потом мелочь.
  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || (m.data.ghost ?? 0) > 0) continue;
    // За воротами (спящая стража Зала) — не цель: туда не пройти.
    if (Math.hypot(m.x - cx, m.y - cy) > F15B_GEO.r + 0.5) continue;
    const boss = !!MOBS[m.kind]?.boss;
    const d = Math.hypot(m.x - h.x, m.y - h.y) + (boss ? 0 : 1.5);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near) nd = Math.hypot(near.x - h.x, near.y - h.y);
  if (near && nd < 30) {
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    if (!moving && nd > SWORD.reach * 0.8 + near.r * 0.6) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
      // На пути спящий (неуязвимый) — обойти сбоком.
      for (const g of s.mobs) {
        if (g === near || g.kind !== 'f15boss' || g.mode === 'dying' || !((g.data.ghost ?? 0) > 0))
          continue;
        const gx = g.x - h.x;
        const gy = g.y - h.y;
        const along = gx * inp.mx + gy * inp.my;
        const across = gx * inp.my - gy * inp.mx;
        if (along > 0 && along < nd - 1 && Math.abs(across) < g.r + h.r + 0.6) {
          const side = across > 0 ? -1 : 1;
          inp.mx = Math.cos(a + side * 1.2);
          inp.my = Math.sin(a + side * 1.2);
        }
      }
      if (badCell(s, h.x + inp.mx, h.y + inp.my)) {
        inp.mx = Math.cos(a + 1.1);
        inp.my = Math.sin(a + 1.1);
      }
    }
    if (nd < SWORD.reach + near.r && s.time - st.lastAtk > 0.14) {
      inp.attack = true;
      inp.aim = { x: near.x - h.x, y: near.y - h.y };
      st.lastAtk = s.time;
    }
    return inp;
  }
  if (moving) return inp;
  // Никого открытого — держаться в 4 клетках перед звездой.
  const tx = cx;
  const ty = cy + 4;
  const l = Math.hypot(tx - h.x, ty - h.y);
  if (l > 0.8) {
    inp.mx = (tx - h.x) / l;
    inp.my = (ty - h.y) / l;
  }
  return inp;
}

interface Fight {
  won: number;
  s: Sim;
  phases: number;
  low: number;
  finale: number;
  echoes: number;
}

function fight(tier: number, plus: number, seed: number, meat = 5, limit = 600): Fight {
  const s = sim(tier, plus, bossObj.x + 0.5, bossObj.y + 7.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.22, 0.45], miss: 0.12, seed };
  let won = -1;
  let phases = 0;
  let low = 1;
  let finale = 0;
  let echoes = 0;
  const marks: string[] = [];
  const src = new Map<string, number>();
  // Для подбора: `F15FORCE=5` — сразу в фазу (без пролога).
  const force = Number(process.env.F15FORCE ?? 0);
  for (let t = 0; t < limit * 60; t++) {
    if (force && s.boss?.state === 'fight' && s.boss.phase === 0) f15bForce(s, API, force);
    const hp0 = s.hero.hp;
    const firing = s.strikes.filter(
      (z) => z.t + DT >= z.warn && strikeHits(z, s.hero.x, s.hero.y, s.hero.r),
    );
    stepSim(s, DT, bot(s, st));
    if (LOG && s.hero.hp < hp0 - 1) {
      const who =
        firing[0]?.art ??
        (Object.keys(s.hero.status).join('+') ||
          s.mobs
            .filter((m) => Math.hypot(m.x - s.hero.x, m.y - s.hero.y) < 3)
            .map((m) => `${m.kind}:${m.mode}`)[0] ||
          (s.shots.length ? 'shot' : '?'));
      src.set(
        `${s.boss?.phase}:${who}`,
        (src.get(`${s.boss?.phase}:${who}`) ?? 0) + (hp0 - s.hero.hp) / s.stats.maxHp,
      );
    }
    low = Math.min(low, s.hero.hp / s.stats.maxHp);
    if (process.env.F15DBG && t % 120 === 0 && (s.boss?.phase ?? 0) === 5)
      console.log(
        `  n ${s.time.toFixed(0)} ${f15bView(s)?.nova?.stage} hero r ${Math.hypot(s.hero.x - STAR[0], s.hero.y - STAR[1]).toFixed(1)} hp ${Math.round((100 * s.hero.hp) / s.stats.maxHp)} lord ${Math.round((100 * (s.mobs.find((m) => m.kind === 'f15boss')?.hp ?? 0)) / (s.mobs.find((m) => m.kind === 'f15boss')?.maxHp ?? 1))} shards ${s.mobs.filter((m) => m.kind === 'f15b_shard').length}`,
      );
    if (process.env.F15DBG && t % 1200 === 0)
      console.log(
        `  t=${s.time.toFixed(0)} hero ${s.hero.x.toFixed(1)},${s.hero.y.toFixed(1)} ${s.hero.mode} mobs ${s.mobs.map((m) => `${m.kind.replace('f15b_', '')}:${m.mode}:${Math.round((100 * m.hp) / m.maxHp)}%@${m.x.toFixed(1)},${m.y.toFixed(1)}`).join(' ')}`,
      );
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'finale') finale += 1;
      if (e.t === 'boss' && e.what === 'phase') {
        phases += 1;
        marks.push(`${e.text}@${s.time.toFixed(0)}`);
      }
      if (e.t === 'boss' && e.what === 'f15b_kindle_call') {
        echoes += 1;
        marks.push(`эхо${echoes}@${s.time.toFixed(0)}`);
      }
    }
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  if (LOG) {
    const lord = s.mobs.find((m) => m.kind === 'f15boss');
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фаза ${s.boss?.phase}, владыка ${lord ? Math.round((100 * lord.hp) / lord.maxHp) : 0}%, минимум здоровья ${Math.round(low * 100)}%, мяса ${s.sack.meat.f10_heart ?? 0} · ${marks.join(' ')}`,
    );
    console.log(
      '  урон:',
      [...src]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 14)
        .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
        .join(', '),
    );
  }
  return { won, s, phases, low, finale, echoes };
}

describe('этаж 15: Хозяин подземелья', () => {
  it('на Т8+5 с едой бот проходит все шесть фаз за 4–8 минут, не всегда без риска', () => {
    const res = (process.env.F15SEEDS ?? '41,42,43,44')
      .split(',')
      .map((seed) => fight(8, 5, Number(seed)));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(3);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(240);
      expect(r.won).toBeLessThan(480);
      expect(r.echoes).toBe(5);
      expect(r.phases).toBe(5);
      expect(r.finale).toBe(1);
    }
    expect(res.some((r) => r.won < 0 || r.low < 0.45)).toBe(true);
  });
});

/** Бой начат: герой в арене, босс проснулся. */
function started(seed = 5): Sim {
  const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 7.5, seed, 5);
  for (let t = 0; t < 120 && s.boss?.state !== 'fight'; t++) stepSim(s, DT, NO_INPUT);
  expect(s.boss?.state).toBe('fight');
  return s;
}

/** Клетки, куда можно дойти от точки (по проходимым клеткам). */
function reach(s: Sim, x: number, y: number): Set<number> {
  const start = Math.floor(y) * W + Math.floor(x);
  const seen = new Set<number>([start]);
  const q = [start];
  while (q.length) {
    const i = q.pop()!;
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      if (seen.has(j) || !walkableTile(s.tiles[j])) continue;
      seen.add(j);
      q.push(j);
    }
  }
  return seen;
}

const starCell = () => Math.floor(STAR[1] + 2) * W + Math.floor(STAR[0]);
const count = (s: Sim, f: (i: number) => boolean) => [...s.boss!.cells].filter(f).length;
const lordOf = (s: Sim) => s.mobs.find((m) => m.kind === 'f15boss' && m.mode !== 'dying')!;
const guard = (s: Sim, m: Mob) =>
  Number(
    BRAINS.get('f15boss')!.onHit!(s, m, { dmg: 10, crit: false, heavy: false, ang: 0 }, API) ?? 1,
  );

/** Шагать без вреда герою (бессмертие кадра), `f` — ввод на шаг. */
function run(
  s: Sim,
  secs: number,
  f: (s: Sim) => SimInput = () => NO_INPUT,
  stop?: (s: Sim) => boolean,
): void {
  for (let t = 0; t < secs * 60; t++) {
    s.hero.inv = 9;
    stepSim(s, DT, f(s));
    if (stop?.(s)) return;
  }
}

/** Герой бегает кругом у звезды — владыке приходится разворачиваться. */
function circling(x: Sim): SimInput {
  const a = x.time * 0.9;
  const tx = STAR[0] + Math.cos(a) * 7;
  const ty = STAR[1] + Math.sin(a) * 7;
  const l = Math.hypot(tx - x.hero.x, ty - x.hero.y) || 1;
  return { ...NO_INPUT, mx: (tx - x.hero.x) / l, my: (ty - x.hero.y) / l };
}

describe('этаж 15: механики боя', () => {
  it('от стыка с «Миром» до ворот арены — дорога есть, стык открыт', () => {
    const s = sim(8, 5, (F15_JOIN.x0 + F15_JOIN.x1) / 2 + 0.5, band.top + 101.5);
    const bottom = band.top + band.h - 1;
    for (let x = 0; x < W; x++) {
      const open = walkableTile(s.tiles[bottom * W + x]);
      expect(open).toBe(x >= F15_JOIN.x0 && x <= F15_JOIN.x1);
    }
    // Под стыком — пол района «Мира»: из него сюда можно войти.
    expect(
      [...Array(F15_JOIN.x1 - F15_JOIN.x0 + 1).keys()].some((k) =>
        walkableTile(s.tiles[(bottom + 1) * W + F15_JOIN.x0 + k]),
      ),
    ).toBe(true);
    const r = reach(s, (F15_JOIN.x0 + F15_JOIN.x1) / 2 + 0.5, band.top + 101.5);
    expect(r.has((gateObj.y + 1) * W + gateObj.x)).toBe(true);
  });

  it('метки района не попадают в узлы вен «Мира» (его правило ищет их по всей карте)', () => {
    expect(Object.values(F15B_MARK)).not.toContain(F15_MARK.node);
    const s = sim(8, 5, 31.5, band.top + 53);
    for (let y = band.top; y < band.top + band.h; y++)
      for (let x = 0; x < W; x++) expect(s.world.mark[y * W + x] === F15_MARK.node).toBe(false);
  });

  it('эхо встают по очереди — Король, Минотавр, Змей, Гидра, Король демонов — и зажигают звёзды', () => {
    const s = started();
    const st: BotState = { lastAtk: -9, react: [0.22, 0.45], miss: 0, seed: 3 };
    const calls: string[] = [];
    let stars = 0;
    for (let t = 0; t < 200 * 60 && (s.boss?.phase ?? 0) === 0 && s.hero.mode !== 'dead'; t++) {
      s.hero.inv = 9;
      // Спящий владыка неуязвим.
      if (t % 600 === 0) expect(guard(s, lordOf(s))).toBe(0);
      stepSim(s, DT, bot(s, st));
      for (const e of s.events) {
        if (e.t === 'boss' && e.what === 'f15b_echo_call') calls.push(e.text ?? '');
        if (e.t === 'boss' && e.what === 'f15b_kindle_call') stars += 1;
      }
    }
    expect(s.boss?.phase).toBe(1);
    expect(stars).toBe(5);
    expect(f15bView(s)!.echo).toBe(5);
    expect(calls).toEqual(ECHO.names.map((n) => `ЭХО · ${n}`));
  });

  it('владыка поворачивается не быстрее LORD.turn и боком не летает', () => {
    const s = started();
    f15bForce(s, API, 2);
    const m = lordOf(s);
    let face = m.face;
    let worst = 0;
    let side = 0;
    let moving = 0;
    // Герой бегает кругами — владыке приходится разворачиваться.
    run(s, 40, (x) => {
      const a = x.time * 0.9;
      const tx = STAR[0] + Math.cos(a) * 7;
      const ty = STAR[1] + Math.sin(a) * 7;
      const l = Math.hypot(tx - x.hero.x, ty - x.hero.y) || 1;
      const lord = lordOf(x);
      if (lord) {
        worst = Math.max(worst, Math.abs(angDiff(lord.face, face)) / DT);
        face = lord.face;
        const v = Math.hypot(lord.vx, lord.vy);
        if (v > 1.2 && lord.mode === 'chase') {
          moving += 1;
          if (Math.abs(angDiff(Math.atan2(lord.vy, lord.vx), lord.face)) > 1.0) side += 1;
        }
      }
      return { ...NO_INPUT, mx: (tx - x.hero.x) / l, my: (ty - x.hero.y) / l };
    });
    expect(worst).toBeLessThanOrEqual(LORD.turn * 1.25 + 0.5);
    expect(moving).toBeGreaterThan(200);
    expect(side / moving).toBeLessThan(0.03);
  });

  it('гравитация: колодец тянет стоящего героя, без короны лицо открыто', () => {
    const s = started();
    f15bForce(s, API, 2);
    const lord = lordOf(s);
    let pulled = 0;
    let away = 0;
    let home = 0;
    run(s, 45, circling, (x) => {
      const v = f15bView(x)!;
      for (const w of v.wells) {
        const d = Math.hypot(w.x - x.hero.x, w.y - x.hero.y);
        if (d < w.r && d > 0.3 && x.time - w.at > 0.2) pulled = Math.max(pulled, 1);
      }
      if (v.planets.some((p) => p.stage !== 0)) away = Math.max(away, guard(x, lord));
      else if (lord.mode === 'chase') home = Math.max(home, guard(x, lord));
      return pulled > 0 && away > 0 && home > 0;
    });
    expect(pulled).toBe(1);
    expect(away).toBeGreaterThan(1.3);
    expect(home).toBeLessThan(1);
    // Колодец сдвигает: стоящего героя тянет к центру.
    const s2 = started();
    f15bForce(s2, API, 2);
    const v2 = f15bView(s2)!;
    s2.hero.x = STAR[0] + 3;
    s2.hero.y = STAR[1] + 5;
    (v2.wells as { x: number; y: number; at: number; end: number; r: number }[]).push({
      x: STAR[0],
      y: STAR[1] + 5,
      at: s2.time,
      end: s2.time + 3,
      r: LORD.wellR,
    });
    const d0 = Math.hypot(s2.hero.x - STAR[0], s2.hero.y - (STAR[1] + 5));
    run(s2, 1.2);
    const d1 = Math.hypot(s2.hero.x - STAR[0], s2.hero.y - (STAR[1] + 5));
    expect(d1).toBeLessThan(d0 - 0.8);
  });

  it('четверти памяти: лава, бездна, зеркала, круги — и к звезде всегда можно дойти', () => {
    const s = started();
    expect(f15bForce(s, API, 3)).toBe(true);
    let stuck = 0;
    run(
      s,
      10,
      () => NO_INPUT,
      (x) => {
        const hi = Math.floor(x.hero.y) * W + Math.floor(x.hero.x);
        if (!walkableTile(x.tiles[hi])) stuck += 1;
        return false;
      },
    );
    expect(stuck).toBe(0);
    const mk = s.world.mark;
    expect(count(s, (i) => s.tiles[i] === Tile.Deep && mk[i] === MK.lava)).toBeGreaterThan(3);
    expect(count(s, (i) => s.tiles[i] === Tile.Deep && mk[i] === MK.abyss)).toBeGreaterThan(3);
    expect(count(s, (i) => s.tiles[i] === Tile.Wall && mk[i] === MK.mirror)).toBeGreaterThanOrEqual(
      3,
    );
    expect(count(s, (i) => mk[i] === MK.circleA)).toBe(2);
    expect(count(s, (i) => mk[i] === MK.circleB)).toBe(2);
    expect(f15bView(s)!.quads.map((q) => q.kind)).toEqual([...QUADS]);
    // От ворот до звезды и до каждой клетки пола арены — дорога есть.
    const r = reach(s, gateObj.x + 0.5, gateObj.y - 0.5);
    expect(r.has(starCell())).toBe(true);
    const cut = [...s.boss!.cells].filter((i) => walkableTile(s.tiles[i]) && !r.has(i));
    expect(cut).toEqual([]);
  });

  it('затмение гасит память и свет; запахнут — почти не берёт, распахнут — окно', () => {
    const s = started();
    f15bForce(s, API, 3);
    run(s, 8);
    f15bForce(s, API, 4);
    run(s, 0.1);
    const mk = s.world.mark;
    expect(count(s, (i) => s.tiles[i] === Tile.Deep)).toBe(0);
    expect(count(s, (i) => mk[i] === MK.mirror || mk[i] === MK.abyss || mk[i] === MK.lava)).toBe(0);
    const lord = lordOf(s);
    let wrapped = 9;
    let open = 0;
    let darkMax = 0;
    run(
      s,
      40,
      () => NO_INPUT,
      (x) => {
        darkMax = Math.max(darkMax, f15bView(x)!.dark);
        if (lord.mode === 'f15l_dark') wrapped = Math.min(wrapped, guard(x, lord));
        if (lord.mode === 'f15l_open') open = Math.max(open, guard(x, lord));
        return open > 0 && wrapped < 9;
      },
    );
    expect(darkMax).toBeGreaterThan(0.9);
    expect(wrapped).toBeLessThan(0.3);
    expect(open).toBeGreaterThan(1.3);
  });

  it('сверхновая: владыка сливается со звездой, после колец — выдох', () => {
    const s = started();
    f15bForce(s, API, 5);
    const lord = lordOf(s);
    expect(guard(s, lord)).toBe(0);
    let blaze = 0;
    let exhale = 0;
    run(
      s,
      30,
      () => NO_INPUT,
      (x) => {
        const nv = f15bView(x)!.nova;
        if (nv?.stage === 'beams') blaze = Math.max(blaze, guard(x, lord));
        if (nv?.stage === 'exhale') exhale = Math.max(exhale, guard(x, lord));
        return exhale > 0;
      },
    );
    expect(Math.hypot(lord.x - STAR[0], lord.y - STAR[1])).toBeLessThan(0.6);
    expect(blaze).toBeLessThan(1);
    expect(exhale).toBeGreaterThan(1.3);
  });

  it('смерть героя возвращает арену целой, после победы — тоже; с арены выходят', () => {
    const s = started();
    f15bForce(s, API, 3);
    run(s, 8);
    expect(count(s, (i) => s.tiles[i] !== world.tiles[i])).toBeGreaterThan(0);
    s.hero.inv = 0;
    API.hurtEnv(s, 5);
    for (let t = 0; t < 12 * 60 && s.boss?.state === 'fight'; t++) stepSim(s, DT, NO_INPUT);
    expect(s.boss?.state).not.toBe('fight');
    expect(
      count(s, (i) => s.tiles[i] !== world.tiles[i] || s.world.mark[i] !== world.mark[i]),
    ).toBe(0);
    // Победа: арена цела, финал один, ворота выпускают.
    const r = fight(8, 5, 42);
    expect(r.won).toBeGreaterThan(0);
    expect(r.finale).toBe(1);
    const w = r.s;
    expect(
      count(w, (i) => w.tiles[i] !== world.tiles[i] || w.world.mark[i] !== world.mark[i]),
    ).toBe(0);
    let out = false;
    for (let t = 0; t < 20 * 60 && !out; t++) {
      const h = w.hero;
      const tx = gateObj.x + 0.5;
      const ty = gateObj.y + 3;
      const l = Math.hypot(tx - h.x, ty - h.y) || 1;
      stepSim(w, DT, { ...NO_INPUT, mx: (tx - h.x) / l, my: (ty - h.y) / l });
      out = h.y > gateObj.y + 2;
    }
    expect(out).toBe(true);
  });

  it('стража района бьёт честно: метка раньше удара', () => {
    const s = sim(8, 5, 31.5, band.top + 50.5);
    const k = API.spawnMob(s, 'f15b_keeper', 33.5, band.top + 50.5, { mode: 'chase' });
    const sh = API.spawnMob(s, 'f15b_shard', 28.5, band.top + 47.5, { mode: 'chase' });
    let slam = 0;
    let aim = 0;
    run(
      s,
      12,
      () => NO_INPUT,
      (x) => {
        if (x.strikes.some((z) => z.art === 'f15b_kslam' && z.from === k.id && z.t < z.warn))
          slam += 1;
        if (sh.mode === 'f15s_aim') aim += 1;
        return slam > 0 && aim > 0;
      },
    );
    expect(slam).toBeGreaterThan(0);
    expect(aim).toBeGreaterThan(0);
  });
});

describe.runIf(!!process.env.F15SWEEP)('этаж 15: подбор', () => {
  it('сетка снаряжения', () => {
    for (const [tier, plus, meat] of (process.env.F15SWEEP ?? '')
      .split(';')
      .map((x) => x.split(',').map(Number)))
      for (const seed of [61, 62, 63]) fight(tier, plus, seed, meat);
  });
});
