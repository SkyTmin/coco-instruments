// Этаж 12 «Проклятая станция»: бот против Двуликого короля проклятий, путь
// от лифта до арены, поезда (давят своих и засчитывают, короля — оглушают),
// эскалаторы, малая территория куклы, храм с разрезами сеткой и оберегами,
// сброс арены.
//
// Бот — живой игрок средней руки: видит метки и уходит из них рывком за миг
// до удара (с задержкой реакции и изредка проглядев), не стоит на путях,
// когда горит семафор, в храме бежит к ближнему оберегу и бьёт чаши, ест,
// когда здоровья меньше 40%.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, Tile, walkableTile } from '../dungeon-world';
import { API, createSim, NO_INPUT, stepSim, strikeHits, SWORD } from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import { F12_HALL, F12_MARK, F12_PLAT, F12_SHRINE } from './f12';
import { ESC_SPEED, f12King, f12State, inWard, KING, trackDanger } from './f12-brains';

const world = buildWorld(12);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F12LOG;

const band = (id: string) => world.bands.find((b) => b.def.id === id)!;
/** Мировая клетка по местным координатам района. */
const at = (area: string, x: number, y: number): [number, number] => [x, band(area).top + y];

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 12 };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7, meat = 0): Sim {
  const d = dungeon(tier, plus);
  const s = createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
  if (meat) {
    s.sack.meat.f12_stew = meat;
    s.sack.meatBy[F12_SHRINE] = meat;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Бот.
// ---------------------------------------------------------------------------

interface BotState {
  lastAtk: number;
  react: [number, number];
  miss: number;
  seed: number;
  seen?: Map<string, [number, boolean]>;
  path?: { key: string; f: Int32Array; at: number };
}

function notice(st: BotState, key: string): [number, boolean] {
  st.seen ??= new Map();
  let v = st.seen.get(key);
  if (!v) {
    st.seed = (Math.imul(st.seed, 1664525) + 1013904223) >>> 0;
    const a = st.seed / 4294967296;
    st.seed = (Math.imul(st.seed, 1664525) + 1013904223) >>> 0;
    const b = st.seed / 4294967296;
    v = [st.react[0] + a * (st.react[1] - st.react[0]), b < st.miss];
    st.seen.set(key, v);
    if (st.seen.size > 400) st.seen.clear();
  }
  return v;
}

/** Поле расстояний до цели по текущим клеткам. */
function field(s: Sim, tx: number, ty: number, gates = true): Int32Array {
  const f = new Int32Array(W * world.h).fill(-1);
  const q = [ty * W + tx];
  f[q[0]] = 0;
  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      if (j < 0 || j >= f.length || f[j] >= 0) continue;
      const t = s.tiles[j];
      if (!(walkableTile(t) || (gates && t === Tile.Gate))) continue;
      f[j] = f[i] + 1;
      q.push(j);
    }
  }
  return f;
}

/** Шаг к цели: по полю, если далеко; напрямую, если рядом. */
function toward(s: Sim, st: BotState, tx: number, ty: number): [number, number] {
  const h = s.hero;
  const d = Math.hypot(tx - h.x, ty - h.y);
  if (d < 2.2) return [(tx - h.x) / (d || 1), (ty - h.y) / (d || 1)];
  const key = `${Math.floor(tx)},${Math.floor(ty)}`;
  if (!st.path || st.path.key !== key || s.time - st.path.at > 0.6)
    st.path = { key, f: field(s, Math.floor(tx), Math.floor(ty)), at: s.time };
  const f = st.path.f;
  const i = Math.floor(h.y) * W + Math.floor(h.x);
  let mx = tx - h.x;
  let my = ty - h.y;
  let best = f[i] < 0 ? 1e9 : f[i];
  for (const k of [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1]) {
    const j = i + k;
    if (f[j] < 0 || f[j] >= best) continue;
    // По диагонали — только если оба соседа свободны.
    if (Math.abs(k) !== 1 && Math.abs(k) !== W) {
      const sx = k % W === 1 || k % W === -(W - 1) ? 1 : -1;
      if (f[i + sx] < 0 || f[i + (k - sx)] < 0) continue;
    }
    best = f[j];
    mx = (j % W) + 0.5 - h.x;
    my = Math.floor(j / W) + 0.5 - h.y;
  }
  const n = Math.hypot(mx, my) || 1;
  return [mx / n, my / n];
}

const eatIfLow = (s: Sim, inp: SimInput) => {
  const h = s.hero;
  const meat = Object.values(s.sack.meat).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) inp.eat = true;
};

function bot(s: Sim, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  eatIfLow(s, inp);
  const ks = f12King(s);
  // Храм: метка сетки горит — к ближнему оберегу и стоять.
  if (ks && !ks.gridDone && s.time < ks.gridCutUntil) {
    const [react, missed] = notice(st, `g${Math.round(ks.cutAt * 10)}`);
    const since = s.time - (ks.cutAt - KING.gridWarn);
    if (!missed && since > react && ks.wards.length) {
      let bw = ks.wards[0];
      let bd = 1e9;
      for (const w of ks.wards) {
        const d = Math.hypot(w.x - h.x, w.y - h.y);
        if (d < bd) {
          bd = d;
          bw = w;
        }
      }
      if (inWard(s, h.x, h.y) && bd < KING.wardR - 0.45) return inp;
      const [mx, my] = toward(s, st, bw.x, bw.y);
      inp.mx = mx;
      inp.my = my;
      if (bd > 2.2 && h.dashCd <= 0) inp.dash = true;
      return inp;
    }
  }
  // Удары по площади: вот-вот ударит и задевает — рывок наружу.
  for (const z of s.strikes) {
    if (z.mobDmg !== undefined && !z.dmg) continue;
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
    if (left < 0.22 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Линии прицела (тетива короля) — вбок.
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
    if (m.mode !== 'windup' && m.mode !== 'f12_slam') continue;
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
  // Поезд: стоишь на путях, а семафор красный — сойти вбок.
  const td = trackDanger(s, h.x, h.y, 0.35);
  if (td < 2.4) {
    const [react, missed] = notice(st, `t${Math.floor(s.time / 4)}`);
    if (!missed || td < 0.8) {
      void react;
      // Ближняя безопасная сторона — вверх или вниз.
      let dir = 0;
      for (let k = 1; k < 6 && !dir; k++) {
        if (trackDanger(s, h.x, h.y - k, 0.35) > 3 && walkableTile(s.tiles[Math.floor(h.y - k) * W + Math.floor(h.x)])) dir = -1;
        else if (trackDanger(s, h.x, h.y + k, 0.35) > 3 && walkableTile(s.tiles[Math.floor(h.y + k) * W + Math.floor(h.x)])) dir = 1;
      }
      inp.my = dir || 1;
      if (td < 0.6 && h.dashCd <= 0) inp.dash = true;
      return inp;
    }
  }
  // Горящий след стрелы — отойти.
  for (const z of s.zones) {
    if (!z.dps || z.t < (z.warn ?? 0)) continue;
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d < z.r + h.r) {
      inp.mx = (h.x - z.x) / (d || 1);
      inp.my = (h.y - z.y) / (d || 1);
      return inp;
    }
  }
  // Цель: чаши храма; король, когда досягаем; ближний житель.
  let target: Mob | null = null;
  let td2 = 1e9;
  const bowls = ks?.domainOn ? new Set(ks.bowls) : null;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || m.mode === 'escape' || m.mode === 'emerge' || m.mode === 'f12_rise') continue;
    if ((m.data.ghost ?? 0) > 0 || m.kind === 'f12_train') continue;
    if (bowls && !bowls.has(m.id)) continue;
    let d = Math.hypot(m.x - h.x, m.y - h.y);
    if (m.kind === 'f12boss') d -= 3;
    if (d < td2) {
      td2 = d;
      target = m;
    }
  }
  if (target) {
    const d = Math.hypot(target.x - h.x, target.y - h.y);
    if (d > SWORD.reach * 0.8 + target.r * 0.5) {
      const [mx, my] = toward(s, st, target.x, target.y);
      // На пути поезд — ждать у края.
      if (trackDanger(s, h.x + mx * 1.2, h.y + my * 1.2, 0.35) < 2.6) return inp;
      inp.mx = mx;
      inp.my = my;
    }
    if (d < SWORD.reach + target.r && s.time - st.lastAtk > 0.14) {
      inp.attack = true;
      inp.aim = { x: target.x - h.x, y: target.y - h.y };
      st.lastAtk = s.time;
    }
  }
  return inp;
}

// ---------------------------------------------------------------------------
// Босс.
// ---------------------------------------------------------------------------

const bossObj = world.objs.find((o) => o.kind === 'boss')!;
/** Внутри ворот арены. */
const [GX, GY] = at(F12_SHRINE, 31, 27);

interface Fight {
  won: number;
  s: Sim;
  phase: number;
  low: number;
  trainHits: number;
  domains: number;
}

function fight(tier: number, plus: number, seed: number, meat = 5): Fight {
  const s = sim(tier, plus, GX + 0.5, GY + 0.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.22, 0.45], miss: 0.12, seed };
  let won = -1;
  let low = 1;
  let trainHits = 0;
  let domains = 0;
  const modes = new Map<string, number>();
  for (let t = 0; t < 420 * 60; t++) {
    stepSim(s, DT, bot(s, st));
    low = Math.min(low, s.hero.hp / s.stats.maxHp);
    const k = s.mobs.find((m) => m.kind === 'f12boss');
    if (k) modes.set(k.mode, (modes.get(k.mode) ?? 0) + DT);
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'f12_train_wall') trainHits += 1;
      if (e.t === 'boss' && e.what === 'phase' && e.text === 'РАСШИРЕНИЕ ТЕРРИТОРИИ') domains += 1;
    }
    if (won > 0 || s.hero.mode === 'dead' || s.hero.mode === 'dying') break;
  }
  const phase = s.boss?.phase ?? 0;
  if (LOG) {
    const k = s.mobs.find((m) => m.kind === 'f12boss');
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фаза ${phase}, король ${k ? Math.round((100 * k.hp) / k.maxHp) : 0}%, минимум ${Math.round(low * 100)}%, мяса ${s.sack.meat.f12_stew ?? 0}, поезд ${trainHits}, храм ${domains}`,
      [...modes].map(([m, v]) => `${m}:${v.toFixed(0)}`).join(' '),
    );
  }
  return { won, s, phase, low, trainHits, domains };
}

describe('этаж 12: Двуликий король проклятий', () => {
  it('на Т8+5 с едой бот побеждает за 2–6 минут, пройдя храм и все фазы', () => {
    const res = [41, 42, 43, 44].map((seed) => fight(8, 5, seed));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(110);
      expect(r.won).toBeLessThan(370);
      expect(r.phase).toBe(3);
      expect(r.domains).toBeGreaterThanOrEqual(1);
    }
    // Не прогулка: хоть раз король доводит бота до края или побеждает.
    expect(res.some((r) => r.won < 0 || r.low < 0.45)).toBe(true);
  });

  it('на Т8+0 без еды — смерть чаще победы', () => {
    const res = [51, 52, 53].map((seed) => fight(8, 0, seed, 0).won);
    expect(res.filter((t) => t > 0).length).toBeLessThanOrEqual(1);
  });

  it('поезд через арену сбивает короля: урон и оглушение', () => {
    const s = sim(8, 5, GX + 0.5, GY + 0.5, 9);
    for (let t = 0; t < 60; t++) stepSim(s, DT, NO_INPUT);
    const st = f12State(s);
    const arena = st.tracks.find((t) => t.cfg.kind === 'arena')!;
    const k = s.mobs.find((m) => m.kind === 'f12boss')!;
    expect(k).toBeTruthy();
    let hit = false;
    let hp0 = 0;
    for (let t = 0; t < 40 * 60 && !hit; t++) {
      s.hero.hp = s.stats.maxHp;
      // Король стоит на путях посередине арены, не бьёт.
      if (k.mode !== 'f12_trainhit' && k.mode !== 'dying') {
        k.x = (arena.wx0 + arena.wx1) / 2;
        k.y = arena.y + 1;
        k.data.ghost = 0;
        if (k.mode !== 'chase') k.mode = 'chase';
        k.cd = 9;
        k.data.cutCd = 9;
        k.data.bowCd = 9;
        k.data.pyreCd = 9;
        hp0 = k.hp;
      }
      stepSim(s, DT, NO_INPUT);
      if (k.mode === 'f12_trainhit') hit = true;
    }
    expect(hit).toBe(true);
    expect(hp0 - k.hp).toBeGreaterThan(k.maxHp * KING.trainDmg * 0.9);
  });
});

describe.runIf(!!process.env.F12SWEEP)('этаж 12: подбор', () => {
  it('сетка снаряжения', () => {
    for (const [tier, plus, meat] of (process.env.F12SWEEP ?? '').split(';').map((x) => x.split(',').map(Number)))
      for (const seed of [61, 62, 63]) fight(tier, plus, seed, meat);
  });
});

// ---------------------------------------------------------------------------
// Храм.
// ---------------------------------------------------------------------------

/** Довести бой до храма: король на половине, сложил знак. */
function toDomain(seed: number): Sim {
  const s = sim(8, 5, GX + 0.5, GY + 0.5, seed);
  for (let t = 0; t < 4 * 60; t++) stepSim(s, DT, NO_INPUT);
  const k = s.mobs.find((m) => m.kind === 'f12boss')!;
  const b = s.boss!;
  b.phase = 1;
  k.hp = k.maxHp * 0.49;
  for (let t = 0; t < 12 * 60 && !f12King(s)?.domainOn; t++) {
    s.hero.hp = s.stats.maxHp;
    stepSim(s, DT, NO_INPUT);
  }
  return s;
}

describe('этаж 12: жертвенный храм', () => {
  it('расширение переписывает зал, гасит путь арены и ставит три чаши', () => {
    const s = toDomain(21);
    const ks = f12King(s)!;
    expect(ks.domainOn).toBe(true);
    for (let t = 0; t < 3 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
    }
    const b = s.boss!;
    const domain = [...b.cells].filter((i) => s.world.mark[i] === F12_MARK.domain).length;
    expect(domain).toBeGreaterThan(b.cells.size * 0.6);
    expect(f12State(s).tracks.find((t) => t.cfg.kind === 'arena')!.off).toBe(true);
    const bowls = s.mobs.filter((m) => ks.bowls.includes(m.id) && m.mode !== 'dying');
    expect(bowls.length).toBe(3);
    // Король в храме неуязвим.
    const k = s.mobs.find((m) => m.kind === 'f12boss')!;
    expect(k.data.ghost).toBe(1);
  });

  it('разрез сеткой: в обереге цел, вне — ранен; рывок не спасает', () => {
    for (const inside of [true, false]) {
      const s = toDomain(22);
      const ks = f12King(s)!;
      let cut = false;
      let hurt = 0;
      for (let t = 0; t < 10 * 60 && !cut; t++) {
        const h = s.hero;
        if (!ks.gridDone && ks.wards.length && s.time > ks.cutAt - 0.5) {
          const w = ks.wards[0];
          if (inside) {
            h.x = w.x;
            h.y = w.y;
          } else {
            // Подальше от всех оберегов, но в арене.
            h.x = w.x + (w.x > GX ? -KING.wardR - 1.6 : KING.wardR + 1.6);
            h.y = w.y;
            if (inWard(s, h.x, h.y)) h.y += 3;
          }
          h.inv = 0;
        }
        const hp = h.hp;
        stepSim(s, DT, inside ? NO_INPUT : { ...NO_INPUT, dash: s.time > ks.cutAt - 0.05 });
        if (h.hp < hp && s.time >= ks.cutAt) hurt += hp - h.hp;
        if (!ks.gridDone && s.time > ks.gridCutUntil - 0.02) cut = true;
        s.mobs = s.mobs.filter((m) => m.kind === 'f12boss' || ks.bowls.includes(m.id));
        s.strikes = s.strikes.filter((z) => z.art !== 'f12_cut');
      }
      expect(cut).toBe(true);
      if (inside) expect(hurt).toBe(0);
      else expect(hurt).toBeGreaterThan(s.stats.maxHp * 0.1);
    }
  });

  it('три чаши разбиты — храм рушится, король оглушён и открыт вдвое; зал возвращается', () => {
    const s = toDomain(23);
    const ks = f12King(s)!;
    const b = s.boss!;
    for (let t = 0; t < 2 * 60; t++) stepSim(s, DT, NO_INPUT);
    for (const m of s.mobs)
      if (ks.bowls.includes(m.id))
        API.strike(s, { shape: 'circle', x: m.x, y: m.y, r: 0.3, warn: 0, dmg: 0, mobDmg: Infinity });
    let broken = false;
    for (let t = 0; t < 3 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      const k = s.mobs.find((m) => m.kind === 'f12boss');
      if (k?.mode === 'f12_broken') broken = true;
    }
    expect(broken).toBe(true);
    expect(ks.domainOn).toBe(false);
    const domain = [...b.cells].filter((i) => s.world.mark[i] === F12_MARK.domain).length;
    expect(domain).toBe(0);
  });

  it('смерть в храме: арена возвращается как была', () => {
    const s = toDomain(24);
    const b = s.boss!;
    for (let t = 0; t < 2 * 60; t++) stepSim(s, DT, NO_INPUT);
    expect([...b.cells].some((i) => s.world.mark[i] === F12_MARK.domain)).toBe(true);
    s.hero.hp = 0.1;
    API.hurtEnv(s, 1);
    stepSim(s, DT, NO_INPUT);
    expect(b.state).not.toBe('fight');
    for (const i of b.cells) {
      expect(s.tiles[i]).toBe(world.tiles[i]);
      expect(s.world.mark[i]).not.toBe(F12_MARK.domain);
    }
    expect(s.mobs.some((m) => m.kind === 'f12_pillar')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Карта и механики районов.
// ---------------------------------------------------------------------------

describe('этаж 12: карта', () => {
  it('от лифта до ворот арены и от арены до лестницы — путь есть', () => {
    const s = sim(8, 5, 1, 1, 1);
    const lift = world.objs.find((o) => o.kind === 'lift')!;
    const b = s.boss!;
    const f = field(s, lift.x, lift.y + 1, false);
    // Ворота арены: клетка перед воротами снаружи достижима.
    const outside = b.gates.flatMap((g) => [g + W, g - W, g + 1, g - 1]).filter((i) => !b.cells.has(i) && walkableTile(world.tiles[i]));
    expect(outside.some((i) => f[i] > 0)).toBe(true);
    // После победы: печати открыты, лестница достижима из арены.
    const stairs = world.objs.find((o) => o.kind === 'stairs')!;
    const t2 = new Uint8Array(s.tiles);
    for (let i = 0; i < t2.length; i++) if (t2[i] === Tile.Seal) t2[i] = Tile.Floor;
    const s2 = { ...s, tiles: t2 } as Sim;
    const f2 = field(s2, stairs.x, stairs.y);
    expect(f2[bossObj.y * W + bossObj.x]).toBeGreaterThan(0);
  });

  it('три района, 260–360 рядов, лифт — во входном', () => {
    const ids = [F12_HALL, F12_PLAT, F12_SHRINE];
    const rows = ids.reduce((a, id) => a + band(id).h, 0);
    expect(rows).toBeGreaterThanOrEqual(260);
    expect(rows).toBeLessThanOrEqual(360);
    const lift = world.objs.find((o) => o.kind === 'lift')!;
    const b = band(F12_HALL);
    expect(lift.y >= b.top && lift.y < b.top + b.h).toBe(true);
  });

  it('действия этажа: рычаг, щиток и колокол стоят на карте', () => {
    const refs = world.objs.filter((o) => o.use).map((o) => o.ref);
    expect(refs).toContain('f12_lever');
    expect(refs).toContain('f12_breaker');
    expect(refs).toContain('f12_bell');
  });
});

describe('этаж 12: поезда и ленты', () => {
  it('поезд давит жителя на путях — и убийство засчитано', () => {
    const [px, py] = at(F12_PLAT, 30, 17);
    const s = sim(8, 5, px + 0.5, py + 0.5, 3);
    stepSim(s, DT, NO_INPUT);
    const st = f12State(s);
    const t = st.tracks.find((k) => k.area === F12_PLAT && k.y === band(F12_PLAT).top + 14)!;
    expect(t).toBeTruthy();
    s.hero.x = 30.5;
    s.hero.y = t.y - 3.5;
    const m = API.spawnMob(s, 'f12_manyface', 30.5, t.y + 1, {});
    let dead = false;
    for (let k = 0; k < 30 * 60 && !dead; k++) {
      s.hero.hp = s.stats.maxHp;
      if (m.mode !== 'dying') {
        m.x = 30.5;
        m.y = t.y + 1;
        m.vx = 0;
        m.vy = 0;
      }
      stepSim(s, DT, NO_INPUT);
      if (m.mode === 'dying' || !s.mobs.includes(m)) dead = true;
    }
    expect(dead).toBe(true);
    expect(s.delta.kills.f12_manyface ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('герой на путях при поезде ранен, на краю платформы — цел', () => {
    for (const onRails of [true, false]) {
      const [px, py] = at(F12_PLAT, 30, 17);
      const s = sim(8, 5, px + 0.5, py + 0.5, 4);
      stepSim(s, DT, NO_INPUT);
      const t = f12State(s).tracks.find((k) => k.area === F12_PLAT && k.y === band(F12_PLAT).top + 14)!;
      let hurt = 0;
      let passed = false;
      s.mobs = [];
      for (let k = 0; k < 30 * 60 && !passed; k++) {
        s.hero.x = 30.5;
        s.hero.y = onRails ? t.y + 1 : t.y - t.pad - 1.5;
        s.hero.inv = 0;
        const hp = s.hero.hp;
        stepSim(s, DT, NO_INPUT);
        hurt += Math.max(0, hp - s.hero.hp);
        s.hero.hp = s.stats.maxHp;
        s.mobs = s.mobs.filter((m) => m.kind === 'f12_train');
        if (t.train && t.view.front > t.wx1 + 3) passed = true;
      }
      expect(passed).toBe(true);
      if (onRails) expect(hurt).toBeGreaterThan(s.stats.maxHp * 0.2);
      else expect(hurt).toBe(0);
    }
  });

  it('лента эскалатора везёт героя, остановленная — нет', () => {
    const st0 = f12State(sim(8, 5, 1, 1, 1));
    const up = st0.lanes.find((l) => l.base === -1)!;
    const stop = st0.lanes.find((l) => l.base === 0)!;
    expect(up).toBeTruthy();
    expect(stop).toBeTruthy();
    for (const [l, moves] of [
      [up, true],
      [stop, false],
    ] as const) {
      const x = (l.x0 + l.x1) / 2;
      const y = (l.y0 + l.y1) / 2;
      const s = sim(8, 5, x, y, 2);
      s.mobs = [];
      // Бегущая лестница — отдельно, ниже.
      f12State(s).stairs.st = 'done';
      for (let k = 0; k < 60; k++) {
        stepSim(s, DT, NO_INPUT);
        s.mobs = [];
      }
      const dy = s.hero.y - y;
      if (moves) expect(dy).toBeLessThan(-ESC_SPEED * 0.8);
      else expect(Math.abs(dy)).toBeLessThan(0.05);
    }
  });

  it('бегущая лестница: на середине ленты все ленты разом идут вниз вдвое быстрее, потом встают', () => {
    const st0 = f12State(sim(8, 5, 1, 1, 1));
    const up = st0.lanes.find((l) => l.base === -1)!;
    const x = (up.x0 + up.x1) / 2;
    const y = (up.y0 + up.y1) / 2;
    const s = sim(8, 5, x, y, 2);
    let trap = false;
    let dy = 0;
    for (let k = 0; k < 60; k++) {
      const y0 = s.hero.y;
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      s.mobs = [];
      dy += s.hero.y - y0;
      if (s.events.some((e) => e.t === 'boss' && e.what === 'f12_stairs_trap')) trap = true;
    }
    expect(trap).toBe(true);
    // Вниз, и быстрее обычного хода.
    expect(dy).toBeGreaterThan(ESC_SPEED * 1.2);
    const st = f12State(s);
    for (let k = 0; k < 20 * 60; k++) {
      s.hero.x = x - 30;
      stepSim(s, DT, NO_INPUT);
      s.mobs = [];
    }
    expect(st.stairs.st).toBe('done');
    expect(st.lanes.every((l) => l.view.dir === l.base)).toBe(true);
  });

  it('малая территория куклы: метка бьёт внутри, три столба — круг разбит, кукла обмякла', () => {
    const [px, py] = at(F12_HALL, 30, 70);
    const s = sim(8, 5, px + 0.5, py + 0.5, 5);
    stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    const h = s.hero;
    const doll = API.spawnMob(s, 'f12_doll', h.x + 3, h.y, {});
    API.setMode(doll, 'cast');
    doll.data.cx = h.x;
    doll.data.cy = h.y;
    let hurt = 0;
    const st = f12State(s);
    for (let k = 0; k < 4 * 60; k++) {
      h.x = px + 0.5;
      h.y = py + 0.5;
      const hp = h.hp;
      stepSim(s, DT, NO_INPUT);
      hurt += Math.max(0, hp - h.hp);
      h.hp = s.stats.maxHp;
      s.mobs = s.mobs.filter((m) => m === doll || m.kind === 'f12_pillar');
      s.strikes = [];
      s.shots = [];
    }
    expect(st.terrs.length).toBe(1);
    expect(hurt).toBeGreaterThan(s.stats.maxHp * 0.08);
    const tr = st.terrs[0];
    for (const m of s.mobs)
      if (tr.pillars.includes(m.id)) API.strike(s, { shape: 'circle', x: m.x, y: m.y, r: 0.3, warn: 0, dmg: 0, mobDmg: Infinity });
    let dazed = false;
    let broke = false;
    for (let k = 0; k < 60; k++) {
      stepSim(s, DT, NO_INPUT);
      if (doll.mode === 'f12_dazed') dazed = true;
      if (s.events.some((e) => e.t === 'boss' && e.what === 'f12_domain_trap')) broke = true;
    }
    expect(broke).toBe(true);
    expect(dazed).toBe(true);
  });
});
