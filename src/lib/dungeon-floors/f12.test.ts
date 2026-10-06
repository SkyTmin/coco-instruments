// Этаж 12 «Полярная ночь»: бот против Ледникового мамонта, путь от лифта до
// ворот арены (через лебёдку моста), лёд и тонкий лёд, мороз, действия
// этажа, залы-события, ледник арены и его сброс.
//
// Бот — живой игрок средней руки: видит метки и уходит из них рывком за миг
// до удара (с задержкой реакции и изредка проглядев), ест, когда здоровья
// меньше 40%, греется у жаровни, когда мороз на двух долях.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, Tile, walkableTile } from '../dungeon-world';
import {
  API,
  createSim,
  NO_INPUT,
  stepSim,
  strikeHits,
  SWORD,
  usableNear,
  useObject as operate,
} from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import { F12, F12_GROTTO, F12_LAKE, F12_MARK, F12_SHRINE } from './f12';
import { f12Floes, f12State, FROST, GATE_HITS, MAMMOTH, THIN, WINCH_STEPS } from './f12-brains';

const world = buildWorld(12);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F12LOG;
const MK = F12_MARK;

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
    s.sack.meat.f12_tea = meat;
    s.sack.meatBy[F12_SHRINE] = meat;
  }
  return s;
}

const markOf = (s: Sim, x: number, y: number) => s.world.mark[Math.floor(y) * W + Math.floor(x)];

/** Лифт входа — в Гроте (второй лифт у Преддверия — выход с добычей). */
const LIFT = world.objs.find(
  (o) =>
    o.kind === 'lift' &&
    o.y >= band(F12_GROTTO).top &&
    o.y < band(F12_GROTTO).top + band(F12_GROTTO).h,
)!;

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
  /** Куда идти, если врагов рядом нет. */
  goal?: [number, number] | null;
  useT?: number;
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

/** Можно ли идти по клетке: пол, но не вода протоки и не битый лёд. */
function passable(s: Sim, j: number, gates: boolean): boolean {
  const t = s.tiles[j];
  if (!(walkableTile(t) || (gates && t === Tile.Gate))) return false;
  const mk = s.world.mark[j];
  if (mk === MK.current) return false;
  const br = f12State(s)?.broken.get(j);
  return br === undefined;
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
      if (!passable(s, j, gates)) continue;
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
  if (d < 1.6) return [(tx - h.x) / (d || 1), (ty - h.y) / (d || 1)];
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

const hidden = (m: Mob) =>
  m.mode === 'dying' ||
  m.mode === 'escape' ||
  m.mode === 'emerge' ||
  (m.data.ghost ?? 0) > 0 ||
  (m.data.dark ?? 0) > 0;

function bot(s: Sim, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  eatIfLow(s, inp);
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
    const l = Math.hypot(ax, ay) || 1;
    inp.mx = ax / l;
    inp.my = ay / l;
    if (left < 0.25 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Линии прицела (набег, скольжение, пике) — вбок.
  for (const m of s.mobs) {
    const lineMode = m.mode === 'f12b_paw' || m.mode === 'f12b_charge';
    const t = m.tele;
    const ang = lineMode ? m.face : t?.ang;
    const r = lineMode ? 14 : t?.r;
    if (!lineMode && (!t || t.shape !== 'line')) continue;
    const [react, missed] = notice(st, `l${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (missed || m.t < react) continue;
    const w = lineMode ? 3.2 : (t?.w ?? 1);
    const hit = strikeHits(
      { shape: 'line', x: m.x, y: m.y, r: r ?? 1, w, ang, warn: 1, dmg: 0 },
      h.x,
      h.y,
      h.r + 0.3,
    );
    if (!hit) continue;
    const a = (ang ?? 0) + Math.PI / 2;
    const side = Math.cos(a) * (h.x - m.x) + Math.sin(a) * (h.y - m.y) >= 0 ? 1 : -1;
    inp.mx = Math.cos(a) * side;
    inp.my = Math.sin(a) * side;
    if (m.danger > 0 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Замах вплотную — отскок.
  for (const m of s.mobs) {
    const melee =
      m.mode === 'f12_wind' ||
      m.mode === 'f12_slam' ||
      m.mode === 'f12_stomp' ||
      m.mode === 'f12_bristle' ||
      m.mode === 'f12b_tusk' ||
      m.mode === 'f12b_stomp';
    if (!melee || m.danger <= 0) continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const [react, missed] = notice(st, `w${m.id}:${Math.round((s.time - m.t) * 10)}`);
    const reach = Math.max(MOBS[m.kind].reach, m.danger);
    if (!missed && m.t > react && d < reach + m.r + 0.6 && h.dashCd <= 0) {
      const away = Math.atan2(h.y - m.y, h.x - m.x) + 0.9;
      inp.mx = Math.cos(away);
      inp.my = Math.sin(away);
      inp.dash = true;
      return inp;
    }
  }
  // Мороз на двух долях и рядом жаровня — зажечь и погреться.
  const fs = f12State(s);
  if (fs && fs.frost > 2 && fs.frozenT <= 0) {
    for (const o of fs.braziers) {
      const d = Math.hypot(o.x + 0.5 - h.x, o.y + 0.5 - h.y);
      if (d > 9) continue;
      if (d > 1.5) {
        const [mx, my] = toward(s, st, o.x + 0.5, o.y + 1.5);
        inp.mx = mx;
        inp.my = my;
        return inp;
      }
      const u = usableNear(s);
      if (u && u.obj === o && (st.useT ?? -9) < s.time - 0.4) {
        operate(s, u);
        st.useT = s.time;
      }
      if (fs.frost > 0.6) return inp;
    }
  }
  // Цель: босс, когда досягаем; ближний житель.
  let target: Mob | null = null;
  let td2 = 1e9;
  for (const m of s.mobs) {
    if (hidden(m)) continue;
    let d = Math.hypot(m.x - h.x, m.y - h.y);
    if (m.kind === 'f12boss') d -= 3;
    if (d < td2) {
      td2 = d;
      target = m;
    }
  }
  // На пути — драться только с тем, кто рядом.
  if (st.goal && target && target.kind !== 'f12boss' && td2 > 3.6) target = null;
  if (target) {
    const d = Math.hypot(target.x - h.x, target.y - h.y);
    if (d > SWORD.reach * 0.8 + target.r * 0.5) {
      const [mx, my] = toward(s, st, target.x, target.y);
      inp.mx = mx;
      inp.my = my;
    }
    if (d < SWORD.reach + target.r && s.time - st.lastAtk > 0.14) {
      inp.attack = true;
      inp.aim = { x: target.x - h.x, y: target.y - h.y };
      st.lastAtk = s.time;
    }
    return inp;
  }
  if (st.goal) {
    const [mx, my] = toward(s, st, st.goal[0], st.goal[1]);
    inp.mx = mx;
    inp.my = my;
  }
  return inp;
}

// ---------------------------------------------------------------------------
// Босс.
// ---------------------------------------------------------------------------

const bossObj = world.objs.find((o) => o.kind === 'boss')!;
/** Внутри ворот арены. */
const [GX, GY] = at(F12_SHRINE, 32, 16);

interface Fight {
  won: number;
  s: Sim;
  phase: number;
  low: number;
  stuns: number;
  shaman: boolean;
  glacier: number;
}

function fight(tier: number, plus: number, seed: number, meat = 5): Fight {
  const s = sim(tier, plus, GX + 0.5, GY + 0.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.22, 0.45], miss: 0.12, seed };
  let won = -1;
  let low = 1;
  let stuns = 0;
  let shaman = false;
  let glacier = 0;
  const modes = new Map<string, number>();
  for (let t = 0; t < 420 * 60; t++) {
    stepSim(s, DT, bot(s, st));
    low = Math.min(low, s.hero.hp / s.stats.maxHp);
    const k = s.mobs.find((m) => m.kind === 'f12boss');
    if (k) modes.set(k.mode, (modes.get(k.mode) ?? 0) + DT);
    if (s.mobs.some((m) => m.kind === 'f12_shaman')) shaman = true;
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'f12_wall_stun') stuns += 1;
      if (e.t === 'boss' && e.what === 'f12_glacier') glacier += 1;
    }
    if (won > 0 || s.hero.mode === 'dead' || s.hero.mode === 'dying') break;
  }
  const phase = s.boss?.phase ?? 0;
  if (LOG) {
    const k = s.mobs.find((m) => m.kind === 'f12boss');
    const fs = f12State(s)!;
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фаза ${phase}, мамонт ${k ? Math.round((100 * k.hp) / k.maxHp) : 0}%, минимум ${Math.round(low * 100)}%, еды ${s.sack.meat.f12_tea ?? 0}, в стену ${stuns}, ледник ${glacier}, замёрз ${fs.freezes}`,
      [...modes].map(([m, v]) => `${m}:${v.toFixed(0)}`).join(' '),
    );
  }
  return { won, s, phase, low, stuns, shaman, glacier };
}

describe('этаж 12: Ледниковый мамонт', () => {
  it('на Т8+5 с едой бот побеждает за 2–6 минут, пройдя все фазы', () => {
    const res = [41, 42, 43, 44].map((seed) => fight(8, 5, seed));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(3);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(110);
      expect(r.won).toBeLessThan(370);
      expect(r.phase).toBe(3);
      expect(r.shaman).toBe(true);
      expect(r.glacier).toBeGreaterThanOrEqual(1);
    }
    // Набег в стену случается: слабое место работает.
    expect(res.some((r) => r.stuns > 0)).toBe(true);
    // Не прогулка: хоть раз мамонт доводит бота до края или побеждает.
    expect(res.some((r) => r.won < 0 || r.low < 0.45)).toBe(true);
  });

  it('на Т8+0 без еды — смерть чаще победы', () => {
    const res = [51, 52, 53].map((seed) => fight(8, 0, seed, 0).won);
    expect(res.filter((t) => t > 0).length).toBeLessThanOrEqual(1);
  });

  it('набег в стену оглушает мамонта, и в оглушении он открыт вдвое', () => {
    const s = sim(8, 5, GX + 0.5, GY + 0.5, 9);
    for (let t = 0; t < 3 * 60; t++) stepSim(s, DT, NO_INPUT);
    const k = s.mobs.find((m) => m.kind === 'f12boss')!;
    // Герой у восточной стены, мамонт напротив — набег прямо в стену.
    const [ax, ay] = at(F12_SHRINE, 45, 9);
    s.hero.x = ax + 0.5;
    s.hero.y = ay + 0.5;
    k.x = ax - 12;
    k.y = ay + 0.5;
    k.face = 0;
    API.setMode(k, 'f12b_paw');
    let stunned = false;
    for (let t = 0; t < 6 * 60 && !stunned; t++) {
      s.hero.hp = s.stats.maxHp;
      s.hero.inv = 1;
      // Герой отходит с линии в последний момент.
      if (k.mode === 'f12b_charge' && Math.hypot(k.x - s.hero.x, k.y - s.hero.y) < 5)
        s.hero.y = ay - 4;
      stepSim(s, DT, NO_INPUT);
      if (k.mode === 'f12b_stunned') stunned = true;
    }
    expect(stunned).toBe(true);
  });

  it('ледник растёт слоями на третьей фазе, а сброс и победа возвращают арену', () => {
    const s = sim(8, 5, GX + 0.5, GY + 0.5, 11);
    for (let t = 0; t < 3 * 60; t++) stepSim(s, DT, NO_INPUT);
    const k = s.mobs.find((m) => m.kind === 'f12boss')!;
    const b = s.boss!;
    const before = [...b.cells].filter((i) => s.tiles[i] === Tile.Wall).length;
    b.phase = 1;
    k.hp = k.maxHp * 0.49;
    let walls = 0;
    for (let t = 0; t < 14 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      s.hero.inv = 1;
      stepSim(s, DT, NO_INPUT);
      walls = Math.max(walls, [...b.cells].filter((i) => s.tiles[i] === Tile.Wall).length);
    }
    expect(b.phase).toBe(2);
    expect(walls - before).toBeGreaterThan(40);
    // Жаровни не замурованы.
    const fs = f12State(s)!;
    for (const o of fs.braziers)
      if (b.cells.has(o.y * W + o.x)) expect(s.tiles[o.y * W + o.x]).not.toBe(Tile.Wall);
    // Герой пал — арена прежняя.
    s.hero.inv = 0;
    s.hero.hp = 1;
    API.hurtHero(s, 9999, k.x, k.y, 0);
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    for (const i of b.cells) expect(s.tiles[i]).toBe(world.tiles[i]);
  });

  it('шаманка: высоко неуязвима, её смерть оглушает мамонта', () => {
    const s = sim(8, 5, GX + 0.5, GY + 0.5, 12);
    for (let t = 0; t < 3 * 60; t++) stepSim(s, DT, NO_INPUT);
    const k = s.mobs.find((m) => m.kind === 'f12boss')!;
    s.boss!.phase = 2;
    k.hp = k.maxHp * 0.24;
    let sh: Mob | undefined;
    for (let t = 0; t < 6 * 60 && !sh; t++) {
      s.hero.hp = s.stats.maxHp;
      s.hero.inv = 1;
      stepSim(s, DT, NO_INPUT);
      sh = s.mobs.find((m) => m.kind === 'f12_shaman');
    }
    expect(sh).toBeTruthy();
    for (let t = 0; t < 60; t++) stepSim(s, DT, NO_INPUT);
    expect(sh!.data.ghost).toBe(1);
    API.strike(s, {
      shape: 'circle',
      x: sh!.x,
      y: sh!.y,
      r: 0.3,
      warn: 0,
      dmg: 0,
      mobDmg: Infinity,
    });
    // Неуязвимую удар по своим не берёт — дождаться, когда снизится.
    for (let t = 0; t < 8 * 60 && sh!.mode !== 'f12s_low'; t++) {
      s.hero.hp = s.stats.maxHp;
      s.hero.inv = 1;
      stepSim(s, DT, NO_INPUT);
    }
    expect(sh!.mode).toBe('f12s_low');
    API.strike(s, {
      shape: 'circle',
      x: sh!.x,
      y: sh!.y,
      r: 0.3,
      warn: 0,
      dmg: 0,
      mobDmg: Infinity,
    });
    for (let t = 0; t < 10; t++) stepSim(s, DT, NO_INPUT);
    expect(sh!.mode).toBe('dying');
    expect(k.mode).toBe('f12b_stunned');
  });
});

describe.runIf(!!process.env.F12SWEEP)('этаж 12: подбор', () => {
  it('сетка снаряжения', () => {
    for (const [tier, plus, meat] of (process.env.F12SWEEP ?? '')
      .split(';')
      .map((x) => x.split(',').map(Number)))
      for (const seed of [61, 62, 63]) fight(tier, plus, seed, meat);
  });
});

// ---------------------------------------------------------------------------
// Карта.
// ---------------------------------------------------------------------------

describe('этаж 12: карта', () => {
  it('три района, 260–360 рядов, лифт — во входном, карта второй версии', () => {
    const ids = [F12_GROTTO, F12_LAKE, F12_SHRINE];
    const rows = ids.reduce((a, id) => a + band(id).h, 0);
    expect(rows).toBeGreaterThanOrEqual(260);
    expect(rows).toBeLessThanOrEqual(360);
    const lift = LIFT;
    const b = band(F12_GROTTO);
    expect(lift.y >= b.top && lift.y < b.top + b.h).toBe(true);
    expect(F12.mapVer).toBe(2);
    expect(F12.draft).toBeFalsy();
  });

  it('без моста ворота арены недостижимы, лебёдка опускает мост — путь есть; после победы — лестница', () => {
    const s = sim(8, 5, 1, 1, 1);
    const lift = LIFT;
    const b = s.boss!;
    const outside = b.gates
      .flatMap((g) => [g + W, g - W, g + 1, g - 1])
      .filter((i) => !b.cells.has(i) && walkableTile(world.tiles[i]));
    const reach = () => {
      const f = field(s, lift.x, lift.y + 1, false);
      return outside.some((i) => f[i] > 0);
    };
    expect(reach()).toBe(false);
    const winch = world.objs.find((o) => o.ref === 'f12_winch')!;
    s.hero.x = winch.x + 0.5;
    s.hero.y = winch.y + 1.5;
    for (let k = 0; k < WINCH_STEPS; k++) {
      const u = usableNear(s);
      expect(u?.obj).toBe(winch);
      expect(operate(s, u!)).toBe(true);
      for (let t = 0; t < 80; t++) {
        s.mobs = [];
        stepSim(s, DT, NO_INPUT);
      }
    }
    expect(reach()).toBe(true);
    // После победы: печати открыты, лестница достижима из арены.
    const stairs = world.objs.find((o) => o.kind === 'stairs')!;
    const t2 = new Uint8Array(s.tiles);
    for (let i = 0; i < t2.length; i++) if (t2[i] === Tile.Seal) t2[i] = Tile.Floor;
    const s2 = { ...s, tiles: t2 } as Sim;
    const f2 = field(s2, stairs.x, stairs.y);
    expect(f2[bossObj.y * W + bossObj.x]).toBeGreaterThan(0);
  });

  it('действия этажа на карте: жаровня, затвор, гонг, лебёдка', () => {
    const refs = world.objs.filter((o) => o.use).map((o) => o.ref);
    for (const r of ['f12_brazier', 'f12_icegate', 'f12_gong', 'f12_winch'])
      expect(refs).toContain(r);
  });

  it('у каждого района рисовальщику хватает меток (8+), предметов 20+', () => {
    for (const id of [F12_GROTTO, F12_LAKE, F12_SHRINE]) {
      const b = band(id);
      const marks = new Set<number>();
      for (let y = b.top; y < b.top + b.h; y++)
        for (let x = 0; x < W; x++) if (world.mark[y * W + x]) marks.add(world.mark[y * W + x]);
      expect(marks.size).toBeGreaterThanOrEqual(8);
    }
    const refs = new Set(world.objs.filter((o) => o.ref?.startsWith('f12_')).map((o) => o.ref));
    expect(refs.size).toBeGreaterThanOrEqual(20);
  });
});

describe('этаж 12: от лифта до арены', () => {
  /** Один проход бота от лифта до ворот арены. */
  const walk = (seed: number) => {
    const lift = LIFT;
    const s = sim(8, 5, lift.x + 0.5, lift.y - 1.5, seed, 8);
    s.sack.meatBy[F12_GROTTO] = 8;
    const st: BotState = { lastAtk: -9, react: [0.22, 0.45], miss: 0.12, seed };
    const b = s.boss!;
    const gate = b.gates[Math.floor(b.gates.length / 2)];
    const [gx, gy] = [(gate % W) + 0.5, Math.floor(gate / W) + 1.5];
    const winch = world.objs.find((o) => o.ref === 'f12_winch')!;
    let arrived = -1;
    let deaths = 0;
    for (let t = 0; t < 1100 * 60; t++) {
      const fs = f12State(s);
      // Моста нет — сперва к лебёдке.
      const needWinch = (fs?.winch.step ?? 0) < WINCH_STEPS;
      st.goal = needWinch ? [winch.x + 0.5, winch.y + 1.5] : [gx, gy];
      const inp = bot(s, st);
      if (needWinch && Math.hypot(s.hero.x - winch.x - 0.5, s.hero.y - winch.y - 1) < 1.5) {
        const u = usableNear(s);
        if (u?.obj === winch && fs && fs.winch.cd <= 0) operate(s, u);
      }
      const hp0 = s.hero.hp;
      stepSim(s, DT, inp);
      // Ни один удар не сносит больше 40% (иглы ежа однажды били квадратом урона).
      expect(hp0 - s.hero.hp).toBeLessThan(s.stats.maxHp * 0.4);
      if (s.hero.mode === 'dead' || s.hero.mode === 'dying') {
        deaths += 1;
        break;
      }
      if (Math.hypot(s.hero.x - gx, s.hero.y - gy) < 2.5) {
        arrived = s.time;
        break;
      }
    }
    const falls = f12State(s)?.falls ?? 0;
    if (LOG)
      console.log(
        `путь, зерно ${seed}: ${arrived > 0 ? `${arrived.toFixed(0)} с` : 'не дошёл'}, смертей ${deaths}, ` +
          `убито ${s.killed}, провалов ${falls}, замёрз ${f12State(s)?.freezes}, у героя ${Math.round((100 * s.hero.hp) / s.stats.maxHp)}% (${s.hero.x.toFixed(0)},${s.hero.y.toFixed(0)})`,
      );
    return { arrived, deaths, falls };
  };

  // Бой хаотичен: любая правка карты у лифта уводит бота другой дорогой.
  // Поэтому не «каждое зерно», а доля: из четырёх доходят хотя бы три.
  it('бот Т8+5 доходит до ворот арены (3 зерна из 4)', () => {
    const seeds = process.env.F12SEEDS
      ? process.env.F12SEEDS.split(',').map(Number)
      : [71, 72, 73, 74];
    const runs = seeds.map(walk);
    expect(runs.filter((r) => r.arrived > 0).length).toBeGreaterThanOrEqual(
      Math.ceil(seeds.length * 0.75),
    );
    // Герой не проваливается без конца: возврат — только на твёрдое
    // (бот не ждёт льдин протоки, поэтому десятки провалов у него — норма).
    for (const r of runs) expect(r.falls).toBeLessThan(45);
  }, 120000);
});

// ---------------------------------------------------------------------------
// Механики.
// ---------------------------------------------------------------------------

/** Найти клетку района с меткой и свободными соседями. */
function cellWith(area: string, mk: number, pad = 1): [number, number] {
  const b = band(area);
  for (let y = b.top + 2; y < b.top + b.h - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      let ok = true;
      for (let dy = -pad; dy <= pad && ok; dy++)
        for (let dx = -pad; dx <= pad && ok; dx++)
          ok =
            world.mark[(y + dy) * W + x + dx] === mk &&
            world.tiles[(y + dy) * W + x + dx] === Tile.Floor;
      if (ok) return [x + 0.5, y + 0.5];
    }
  throw new Error(`нет клетки ${mk} в ${area}`);
}

describe('этаж 12: лёд и мороз', () => {
  it('на льду герой катится после того, как отпустил ход; на снегу — встаёт', () => {
    const slide = (mk: number) => {
      const [x, y] = cellWith(F12_LAKE, mk, 3);
      const s = sim(8, 5, x, y, 3);
      for (let t = 0; t < 40; t++) {
        s.mobs = [];
        stepSim(s, DT, { ...NO_INPUT, mx: 1 });
      }
      const x0 = s.hero.x;
      for (let t = 0; t < 40; t++) {
        s.mobs = [];
        stepSim(s, DT, NO_INPUT);
      }
      return s.hero.x - x0;
    };
    const ice = slide(MK.ice);
    const snow = slide(MK.snow);
    expect(ice).toBeGreaterThan(0.9);
    expect(snow).toBeLessThan(0.4);
  });

  it('тонкий лёд под стоящим ломается: полынья, падение с уроном и возврат на твёрдое; потом замерзает', () => {
    const [x, y] = cellWith(F12_LAKE, MK.thin, 0);
    const s = sim(8, 5, x, y, 4);
    const fs0 = f12State(s);
    void fs0;
    let fell = false;
    let hp0 = s.hero.hp;
    for (let t = 0; t < 8 * 60 && !fell; t++) {
      s.mobs = [];
      hp0 = s.hero.hp;
      stepSim(s, DT, NO_INPUT);
      if (f12State(s)!.falls > 0) fell = true;
    }
    expect(fell).toBe(true);
    expect(s.hero.hp).toBeLessThan(hp0);
    const i = Math.floor(y) * W + Math.floor(x);
    expect(s.tiles[i]).toBe(Tile.Deep);
    expect(Math.hypot(s.hero.x - x, s.hero.y - y)).toBeGreaterThan(0.6);
    for (let t = 0; t < (THIN.refreeze + 2) * 60; t++) {
      s.mobs = [];
      s.hero.x = x + 30;
      stepSim(s, DT, NO_INPUT);
    }
    expect(s.tiles[i]).toBe(Tile.Floor);
    expect(s.world.mark[i]).toBe(MK.thin);
  });

  it('мороз копится долями, на трёх — заморозка на секунду; удар разбивает лёд; тепло снимает', () => {
    const [x, y] = cellWith(F12_SHRINE, MK.snow, 2);
    const s = sim(8, 5, x, y, 5);
    const fs = f12State(s) ?? (stepSim(s, DT, NO_INPUT), f12State(s)!);
    fs.storm.state = 'done';
    let frozenAt = -1;
    for (let t = 0; t < 140 * 60 && frozenAt < 0; t++) {
      s.mobs = [];
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      if (fs.frozenT > 0) frozenAt = s.time;
    }
    expect(frozenAt).toBeGreaterThan(60);
    expect(s.hero.status.stun).toBeTruthy();
    // Удар по замёрзшему — лёд вдребезги.
    s.hero.inv = 0;
    API.hurtHero(s, 30, s.hero.x + 1, s.hero.y, 0);
    // Стоп-кадр удара пропускает шаг мира.
    for (let t = 0; t < 8; t++) stepSim(s, DT, NO_INPUT);
    expect(fs.shatters).toBe(1);
    expect(fs.frozenT).toBe(0);
    // У тёплого источника мороз тает.
    fs.frost = 2.5;
    const spring = [...Array(world.w * world.h).keys()].find((i) => world.mark[i] === MK.spring)!;
    s.hero.x = (spring % W) + 0.5;
    s.hero.y = Math.floor(spring / W) - 0.5;
    for (let k = 0; k < 6; k++) {
      // ищем тёплую клетку рядом с источником
      if (fs.warm[Math.floor(s.hero.y) * W + Math.floor(s.hero.x)]) break;
      s.hero.y -= 1;
    }
    const f0 = fs.frost;
    for (let t = 0; t < 3 * 60; t++) {
      s.mobs = [];
      stepSim(s, DT, NO_INPUT);
    }
    expect(fs.frost).toBeLessThan(f0 - FROST.thaw * 2);
  });
});

describe('этаж 12: действия и залы', () => {
  it('затвор бьют только с севера: три удара — короткий путь открыт', () => {
    const gate = world.objs.find((o) => o.ref === 'f12_icegate')!;
    const s = sim(8, 5, gate.x + 0.5, gate.y + 1.6, 6);
    s.mobs = [];
    expect(usableNear(s)?.obj === gate).toBe(false);
    s.hero.y = gate.y - 0.6;
    for (let k = 0; k < GATE_HITS; k++) {
      const u = usableNear(s);
      expect(u?.obj).toBe(gate);
      operate(s, u!);
      stepSim(s, DT, NO_INPUT);
    }
    expect(s.tiles[gate.y * W + gate.x]).toBe(Tile.Floor);
  });

  it('жаровня в Зале вмёрзших будит двух воинов; три жаровни — стена ниши тает', () => {
    const fs0 = f12State(sim(8, 5, 1, 1, 1));
    void fs0;
    const s = sim(8, 5, 1, 1, 7);
    stepSim(s, DT, NO_INPUT);
    const fs = f12State(s)!;
    const [x0, y0, x1, y1] = fs.thaw.box;
    const mine = fs.braziers.filter((o) => o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1);
    expect(mine.length).toBe(3);
    s.hero.x = (x0 + x1) / 2 + 0.5;
    s.hero.y = (y0 + y1) / 2 + 0.5;
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    const frozen = () =>
      s.mobs.filter((m) => m.kind === 'f12_warrior' && m.mode === 'f12_frozen').length;
    const f0 = frozen();
    expect(f0).toBeGreaterThanOrEqual(4);
    for (const o of mine) {
      s.hero.x = o.x + 0.5;
      s.hero.y = o.y + 1.4;
      s.hero.hp = s.stats.maxHp;
      const u = usableNear(s);
      expect(u?.obj).toBe(o);
      operate(s, u!);
      stepSim(s, DT, NO_INPUT);
    }
    expect(frozen()).toBeLessThanOrEqual(f0 - 4);
    for (let t = 0; t < 5 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      s.hero.inv = 1;
      stepSim(s, DT, NO_INPUT);
    }
    expect(fs.thaw.state).toBe('done');
    for (const i of fs.thaw.wall) expect(s.tiles[i]).toBe(Tile.Floor);
  });

  it('Безмолвие гасит факелы и прячет мобов; гонг их показывает и слепит', () => {
    const s = sim(8, 5, 1, 1, 8);
    stepSim(s, DT, NO_INPUT);
    const fs = f12State(s)!;
    const [x0, y0, x1, y1] = fs.hush.box;
    s.hero.x = (x0 + x1) / 2 + 0.5;
    s.hero.y = y1 - 1.5;
    for (let t = 0; t < 40; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
    }
    expect(fs.hush.state).toBe('on');
    expect(fs.hush.torches.length).toBeGreaterThan(0);
    expect(fs.hush.torches.every((id) => !fs.torchOn.has(id))).toBe(true);
    const hush = s.mobs.filter((m) => fs.hush.mobs.has(m.id));
    expect(hush.some((m) => (m.data.ghost ?? 0) > 0)).toBe(true);
    const gong = world.objs.find((o) => o.ref === 'f12_gong')!;
    s.hero.x = gong.x + 0.5;
    s.hero.y = gong.y + 1.5;
    const u = usableNear(s);
    expect(u?.obj).toBe(gong);
    operate(s, u!);
    stepSim(s, DT, NO_INPUT);
    expect(fs.reveal).toBeGreaterThan(0);
    const near = s.mobs.filter(
      (m) => fs.hush.mobs.has(m.id) && Math.hypot(m.x - gong.x, m.y - gong.y) < 10,
    );
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((m) => (m.data.blind ?? 0) > 0)).toBe(true);
    expect(near.every((m) => (m.data.ghost ?? 0) === 0)).toBe(true);
  });

  it('Ледоход: на воде без льдины — провал, на льдине — едешь с ней', () => {
    const s = sim(8, 5, 1, 1, 9);
    stepSim(s, DT, NO_INPUT);
    const fs = f12State(s)!;
    const [cx0, cy0, cx1, cy1] = fs.drift.box;
    s.hero.x = (cx0 + cx1) / 2 + 0.5;
    s.hero.y = cy1 + 3;
    for (let t = 0; t < 10; t++) stepSim(s, DT, NO_INPUT);
    const floes = f12Floes(s);
    expect(floes.length).toBeGreaterThan(3);
    const f = floes.find((x) => x.y > cy0 + 4 && x.y < cy1 - 4)!;
    s.hero.x = f.x;
    s.hero.y = f.y;
    s.mobs = [];
    const y0 = s.hero.y;
    for (let t = 0; t < 60; t++) {
      s.mobs = [];
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
    }
    expect(fs.falls).toBe(0);
    expect(s.hero.y).toBeLessThan(y0 - 0.7);
    // Вода между льдинами.
    let wx = -1;
    let wy = -1;
    for (let y = cy0 + 2; y < cy1 - 2 && wx < 0; y++)
      for (let x = cx0; x <= cx1 && wx < 0; x++)
        if (
          markOf(s, x, y) === MK.current &&
          !f12Floes(s).some(
            (q) => Math.hypot((x + 0.5 - q.x) / (q.rx + 0.8), (y + 0.5 - q.y) / (q.ry + 0.8)) < 1,
          )
        ) {
          wx = x + 0.5;
          wy = y + 0.5;
        }
    s.hero.x = wx;
    s.hero.y = wy;
    stepSim(s, DT, NO_INPUT);
    expect(fs.falls).toBe(1);
  });

  it('Ледолом: фронт бьёт лёд за спиной, бот, что стоит, проваливается', () => {
    const s = sim(8, 5, 1, 1, 10);
    stepSim(s, DT, NO_INPUT);
    const fs = f12State(s)!;
    const [x0, y0, x1, y1] = fs.rapids.box;
    // Середина Стремнины на льду.
    let px = -1;
    let py = -1;
    for (let y = y1 - 10; y > y0 + 6 && px < 0; y--)
      for (let x = x0 + 2; x < x1 - 2 && px < 0; x++)
        if (markOf(s, x, y) === MK.ice && s.tiles[y * W + x] === Tile.Floor) {
          px = x + 0.5;
          py = y + 0.5;
        }
    s.hero.x = px;
    s.hero.y = py;
    for (let t = 0; t < 12 * 60 && fs.falls === 0; t++) {
      s.mobs = [];
      s.hero.hp = s.stats.maxHp;
      s.hero.x = px;
      s.hero.y = py;
      stepSim(s, DT, NO_INPUT);
    }
    expect(fs.rapids.state).not.toBe('idle');
    expect(fs.falls).toBeGreaterThan(0);
  });

  it('сбитый на льду тюлень съезжает в полынью', () => {
    const s = sim(8, 5, 1, 1, 13);
    stepSim(s, DT, NO_INPUT);
    // Ищем лёд у глубины.
    let p: [number, number] | null = null;
    const b = band(F12_LAKE);
    for (let y = b.top + 3; y < b.top + b.h - 3 && !p; y++)
      for (let x = 3; x < W - 3 && !p; x++)
        if (
          world.mark[y * W + x] === MK.ice &&
          world.tiles[y * W + x] === Tile.Floor &&
          world.tiles[y * W + x + 1] === Tile.Deep &&
          world.mark[y * W + x - 1] === MK.ice
        )
          p = [x + 0.5, y + 0.5];
    expect(p).toBeTruthy();
    s.hero.x = p![0] - 3;
    s.hero.y = p![1];
    const m = API.spawnMob(s, 'f12_seal', p![0] - 0.6, p![1], { mode: 'recover' });
    m.kx = 6;
    let fell = false;
    for (let t = 0; t < 90 && !fell; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      if (m.fell) fell = true;
    }
    expect(fell).toBe(true);
  });

  it('свет на ходу: в Куполе ленты сияния ползут, а совы прилетают волнами', () => {
    const s = sim(8, 5, 1, 1, 14);
    stepSim(s, DT, NO_INPUT);
    const fs = f12State(s)!;
    s.hero.x = fs.dome.cx;
    s.hero.y = fs.dome.cy;
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    expect(fs.dome.state).toBe('on');
    const l0 = s.lightKeys.get('f12a:0');
    expect(l0).toBeTruthy();
    const x0 = l0!.x;
    for (let t = 0; t < 120; t++) {
      s.hero.hp = s.stats.maxHp;
      s.hero.inv = 1;
      stepSim(s, DT, NO_INPUT);
    }
    expect(Math.abs(s.lightKeys.get('f12a:0')!.x - x0)).toBeGreaterThan(0.5);
    expect(s.mobs.filter((m) => m.kind === 'f12_owl').length).toBeGreaterThanOrEqual(2);
  });
});

void MAMMOTH;
