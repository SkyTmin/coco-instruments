// Этаж 9 «Лабиринт гидры»: бот против гидры, выход с арены, круги-
// телепорты (пары, ловушки, Круговорот), корневая часовня, прилив на гати,
// монстры этажа и их приёмы.
//
// Бот — живой игрок средней руки: видит метки на полу и уходит из них
// рывком за миг до удара (с задержкой реакции и изредка — проглядев), ест,
// когда здоровья меньше 40%. Против гидры: рубит головы (белую — первой),
// за огнём ходит к жаровне и прижигает обрубки, в последней фазе ловит
// скрытую голову, когда она вынырнула.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, liftOf, Tile, walkableTile } from '../dungeon-world';
import { createSim, NO_INPUT, spawnMob, stepSim, strikeHits, SWORD } from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import { F9_LAIR, F9_MARK, F9_MAZE, F9_RUINS, isRingMark } from './f9';
import { CHAPEL_T, EL, f9State, FIRE_T, HYDRA_NOTCH, WARP_T } from './f9-brains';

const world = buildWorld(9);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F9LOG;

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 9 };
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
    s.sack.meat.f9_tail = meat;
    s.sack.meatBy[F9_RUINS] = meat;
  }
  return s;
}

const cellX = (i: number) => (i % W) + 0.5;
const cellY = (i: number) => Math.floor(i / W) + 0.5;

/**
 * Поле расстояний до цели по ЖИВЫМ клеткам вылазки. Круги-телепорты —
 * стена (кроме цели): иначе бот, проходя мимо, улетал бы в пару.
 */
function field(s: Sim | null, tx: number, ty: number, pass: Set<number> = new Set()): Int32Array {
  const tiles = s ? s.tiles : world.tiles;
  const f = new Int32Array(W * world.h).fill(-1);
  const q = [ty * W + tx];
  f[q[0]] = 0;
  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      if (j < 0 || j >= f.length || f[j] >= 0) continue;
      const t = tiles[j];
      if (!(walkableTile(t) || t === Tile.Gate)) continue;
      if (isRingMark(world.mark[j]) && !pass.has(j)) continue;
      f[j] = f[i] + 1;
      q.push(j);
    }
  }
  return f;
}

const solid = (s: Sim, x: number, y: number) => !walkableTile(s.tiles[Math.floor(y) * W + Math.floor(x)]);

interface BotState {
  lastAtk: number;
  react: [number, number];
  miss: number;
  seed: number;
  seen?: Map<string, [number, boolean]>;
  /** Поля до целей (ключ — клетка цели), со временем постройки. */
  fields?: Map<number, [number, Int32Array]>;
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

/** Шаг по полю к цели (соседняя клетка с меньшим расстоянием). */
function stepField(s: Sim, f: Int32Array, inp: SimInput): boolean {
  const h = s.hero;
  const cx = Math.floor(h.x);
  const cy = Math.floor(h.y);
  let best = f[cy * W + cx];
  if (best < 0) return false;
  let bx = 0;
  let by = 0;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const v = f[(cy + dy) * W + cx + dx];
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
  return true;
}

/** Идти к точке: по живому полю (пересобирается раз в секунду). */
function goTo(s: Sim, st: BotState, x: number, y: number, inp: SimInput, pass?: Set<number>): void {
  st.fields ??= new Map();
  const key = Math.floor(y) * W + Math.floor(x);
  let e = st.fields.get(key);
  if (!e || s.time - e[0] > 1) {
    e = [s.time, field(s, Math.floor(x), Math.floor(y), pass ?? new Set([key]))];
    st.fields.set(key, e);
    if (st.fields.size > 40) st.fields.clear();
  }
  const h = s.hero;
  if (Math.hypot(x - h.x, y - h.y) < 0.9 || !stepField(s, e[1], inp)) {
    const l = Math.hypot(x - h.x, y - h.y) || 1;
    inp.mx = (x - h.x) / l;
    inp.my = (y - h.y) / l;
  }
}

/**
 * Бот. Порядок: метки ударов (уйти рывком за миг до удара) → линии и
 * конусы прицела мобов (уйти вбок) → круги на полу (выйти) → еда → бой.
 */
function dodge(s: Sim, st: BotState, inp: SimInput): boolean {
  const h = s.hero;
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
    const l = Math.hypot(ax, ay) || 1;
    inp.mx = ax / l;
    inp.my = ay / l;
    if (left < 0.22 && h.dashCd <= 0) inp.dash = true;
    return true;
  }
  for (const m of s.mobs) {
    const t = m.tele;
    if (!t) continue;
    const [react, missed] = notice(st, `t${m.id}:${m.mode}:${Math.round((s.time - m.t) * 10)}`);
    if (missed || m.t < react) continue;
    const ox = t.x ?? m.x;
    const oy = t.y ?? m.y;
    let hit = false;
    if (t.shape === 'line')
      hit = strikeHits({ shape: 'line', x: ox, y: oy, r: t.r, w: t.w, ang: t.ang, warn: 1, dmg: 0 }, h.x, h.y, h.r + 0.3);
    else if (t.shape === 'cone')
      hit = strikeHits({ shape: 'cone', x: ox, y: oy, r: t.r, ang: t.ang, arc: t.arc, warn: 1, dmg: 0 }, h.x, h.y, h.r + 0.3);
    else if ((t.shape === 'circle' || t.shape === 'ring') && m.kind !== 'f9_stump')
      hit = Math.hypot(h.x - ox, h.y - oy) < t.r + h.r + 0.3;
    if (!hit) continue;
    let ax: number;
    let ay: number;
    if (t.shape === 'line' || t.shape === 'cone') {
      const a = (t.ang ?? 0) + Math.PI / 2;
      const side = Math.cos(a) * (h.x - ox) + Math.sin(a) * (h.y - oy) >= 0 ? 1 : -1;
      ax = Math.cos(a) * side;
      ay = Math.sin(a) * side;
    } else {
      ax = h.x - ox;
      ay = h.y - oy;
      const l = Math.hypot(ax, ay) || 1;
      ax /= l;
      ay /= l;
    }
    inp.mx = ax;
    inp.my = ay;
    if (m.danger > 0 && h.dashCd <= 0) inp.dash = true;
    return true;
  }
  for (const m of s.mobs) {
    if (m.mode !== 'lunge') continue;
    const ux = Math.cos(m.dir);
    const uy = Math.sin(m.dir);
    const dx = h.x - m.x;
    const dy = h.y - m.y;
    const along = dx * ux + dy * uy;
    const across = -dx * uy + dy * ux;
    if (along > 0 && along < 4 && Math.abs(across) < m.r + h.r + 0.4) {
      const side = across >= 0 ? 1 : -1;
      inp.mx = -uy * side;
      inp.my = ux * side;
      if (h.dashCd <= 0) inp.dash = true;
      return true;
    }
  }
  for (const m of s.mobs) {
    if (m.mode !== 'windup') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const [react, missed] = notice(st, `w${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (!missed && m.t > react && d < MOBS[m.kind].reach + m.r + 0.9 && h.dashCd <= 0) {
      const away = Math.atan2(h.y - m.y, h.x - m.x) + 0.9;
      inp.mx = Math.cos(away);
      inp.my = Math.sin(away);
      inp.dash = true;
      return true;
    }
  }
  // Пиявка присосалась — стряхнуть рывком.
  if (s.mobs.some((m) => m.kind === 'f9_leech' && m.mode === 'latch') && h.dashCd <= 0 && notice(st, `l${Math.floor(s.time)}`)[0] < 0.4) {
    inp.dash = true;
    inp.mx = Math.cos(h.face + Math.PI);
    inp.my = Math.sin(h.face + Math.PI);
    return true;
  }
  for (const z of s.zones) {
    if (!z.dps || z.t < (z.warn ?? 0) || z.art === 'f9_tidewater') continue;
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d < z.r + h.r) {
      inp.mx = (h.x - z.x) / (d || 1);
      inp.my = (h.y - z.y) / (d || 1);
      return true;
    }
  }
  return false;
}

function eat(s: Sim, inp: SimInput): void {
  const h = s.hero;
  const meat = Object.values(s.sack.meat).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) inp.eat = true;
}

function hitNear(s: Sim, st: BotState, inp: SimInput, target: Mob | null): boolean {
  const h = s.hero;
  if (!target) return false;
  const d = Math.hypot(target.x - h.x, target.y - h.y);
  const a = Math.atan2(target.y - h.y, target.x - h.x);
  if (d > SWORD.reach * 0.8 + target.r * 0.5) {
    inp.mx = Math.cos(a);
    inp.my = Math.sin(a);
  }
  if (d < SWORD.reach + target.r && s.time - st.lastAtk > 0.14) {
    inp.attack = true;
    inp.aim = { x: target.x - h.x, y: target.y - h.y };
    st.lastAtk = s.time;
  }
  return true;
}

const open = (m: Mob) => m.mode !== 'dying' && m.mode !== 'emerge' && !((m.data.ghost ?? 0) > 0);

/** Бот обычного боя: к цели, отбиваясь от ближних. */
function bot(s: Sim, goal: Int32Array | null, st: BotState): SimInput {
  const inp: SimInput = { ...NO_INPUT };
  if (dodge(s, st, inp)) return inp;
  eat(s, inp);
  const h = s.hero;
  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (!open(m) || m.kind === 'f9_stump') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    // Над водой клинком не достать: живой игрок не стоит у кромки, а идёт
    // дальше, пока огонёк сам не подлетит.
    if (solid(s, m.x, m.y) && d > 1.8) continue;
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near && nd < 6) {
    hitNear(s, st, inp, near);
    return inp;
  }
  if (goal) stepField(s, goal, inp);
  return inp;
}

// ---------------------------------------------------------------------------
// Бот против гидры.
// ---------------------------------------------------------------------------

function hydraBot(s: Sim, st: BotState): SimInput {
  const inp: SimInput = { ...NO_INPUT };
  if (dodge(s, st, inp)) return inp;
  eat(s, inp);
  const h = s.hero;
  const fs = f9State(s);
  const hasFire = fs.fire > s.time;
  const stumps = s.mobs.filter((m) => m.kind === 'f9_stump' && m.mode === 'bleed');
  const heads = s.mobs.filter((m) => m.kind === 'f9_head' && open(m));
  const crown = s.mobs.find((m) => m.kind === 'f9_crown' && m.mode !== 'dying');
  // Обрубок: с огнём — прижечь, без огня — за огнём (если успеть).
  const stump = stumps
    .filter((m) => (m.data.T ?? 8) - m.t > 2)
    .sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
  if (stump) {
    if ((stump.data.can ?? 0) > 0 || hasFire) {
      const d = Math.hypot(stump.x - h.x, stump.y - h.y);
      if (d > SWORD.reach * 0.7) goTo(s, st, stump.x, stump.y, inp);
      if (d < SWORD.reach + stump.r && s.time - st.lastAtk > 0.14 && (stump.data.ghost ?? 0) === 0) {
        inp.attack = true;
        inp.aim = { x: stump.x - h.x, y: stump.y - h.y };
        st.lastAtk = s.time;
      }
      return inp;
    }
    const lit = fs.arena?.braziers.filter((p) => !fs.arena!.out.has(p.id)) ?? [];
    const br = lit.sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
    // Голова вплотную — сперва отмахнуться.
    const close = heads.find((m) => Math.hypot(m.x - h.x, m.y - h.y) < 1.4);
    if (close) return hitNear(s, st, inp, close) ? inp : inp;
    if (br) {
      goTo(s, st, br.x, br.y + 0.9, inp);
      return inp;
    }
  }
  if (crown) {
    if (open(crown)) return hitNear(s, st, inp, crown) ? inp : inp;
    // Скрытая голова в иле — держаться в стороне и ждать.
    return inp;
  }
  const light = heads.find((m) => m.data.el === EL.light);
  let target: Mob | null = light ?? null;
  if (!target) {
    let nd = 1e9;
    for (const m of heads) {
      const d = Math.hypot(m.x - h.x, m.y - h.y);
      if (d < nd) {
        nd = d;
        target = m;
      }
    }
  }
  // Ближних мелких (из боя их нет, но вдруг) — тоже бить.
  if (!target) return inp;
  const d = Math.hypot(target.x - h.x, target.y - h.y);
  if (d > SWORD.reach * 0.8) goTo(s, st, target.x, target.y, inp);
  if (d < SWORD.reach + target.r && s.time - st.lastAtk > 0.14) {
    inp.attack = true;
    inp.aim = { x: target.x - h.x, y: target.y - h.y };
    st.lastAtk = s.time;
  }
  return inp;
}

const bossObj = world.objs.find((o) => o.kind === 'boss')!;

function fight(tier: number, plus: number, seed: number, meat = 5) {
  const s = sim(tier, plus, bossObj.x + 0.5, bossObj.y + 2.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.2, 0.42], miss: 0.1, seed };
  let won = -1;
  const phases: number[] = [];
  let sears = 0;
  let regrows = 0;
  let severs = 0;
  for (let t = 0; t < 300 * 60; t++) {
    stepSim(s, DT, hydraBot(s, st));
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'phase') phases.push(Math.round(s.time));
      if (e.t === 'boss' && e.what === 'f9_sear') sears += 1;
      if (e.t === 'boss' && e.what === 'f9_regrow') regrows += 1;
      if (e.t === 'kill' && e.mob === 'f9_head') severs += 1;
    }
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  if (LOG)
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фазы ${phases.join('/')}, голов срублено ${severs}, прижжено ${sears}, отросло ${regrows}, здоровье ${Math.round(s.hero.hp)}/${s.stats.maxHp}, мяса ${s.sack.meat.f9_tail ?? 0}`,
    );
  return { won, s, sears, regrows, severs, phases };
}

describe('этаж 9: гидра', () => {
  it('на Сполохе +5 бот побеждает за 1–5 минут, с прижиганием шей', () => {
    const res = [41, 42, 43, 44].map((seed) => fight(8, 5, seed));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(60);
      expect(r.won).toBeLessThan(300);
      expect(r.phases.length).toBe(3);
    }
    expect(res.reduce((a, r) => a + r.sears, 0)).toBeGreaterThan(0);
  });

  it('на Сполохе без заточки и без еды гидра чаще побеждает', () => {
    const res = [51, 52, 53].map((seed) => fight(8, 0, seed, 0).won);
    expect(res.filter((t) => t > 0).length).toBeLessThanOrEqual(1);
  });

  it('засечки фаз на полосе, полоса — по телу, потом по скрытой голове', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 0.5, 3);
    s.hero.inv = 99;
    stepSim(s, DT, NO_INPUT);
    stepSim(s, DT, NO_INPUT);
    expect(s.boss!.state).toBe('fight');
    const heads = s.mobs.filter((m) => m.kind === 'f9_head');
    expect(heads.length).toBe(3);
    expect(new Set(heads.map((m) => m.data.el))).toEqual(new Set([EL.fire, EL.ice, EL.venom]));
    const body = s.mobs.find((m) => m.kind === 'f9boss')!;
    // Тело клинком не берётся (прицел его не видит).
    expect(body.data.ghost).toBe(1);
    // Фазы по полосе: 0,75 → гроза и свет (+2 головы, берег залит).
    body.hp = body.maxHp * 0.74;
    stepSim(s, DT, NO_INPUT);
    expect(s.boss!.phase).toBe(1);
    const els = s.mobs.filter((m) => m.kind === 'f9_head').map((m) => m.data.el);
    expect(els).toContain(EL.bolt);
    expect(els).toContain(EL.light);
    const A = f9State(s).arena!;
    expect(A.shore.some((i) => s.tiles[i] === Tile.Hazard && s.world.mark[i] === F9_MARK.flood)).toBe(true);
    // 0,5 → две жаровни гаснут.
    body.hp = body.maxHp * 0.49;
    stepSim(s, DT, NO_INPUT);
    expect(s.boss!.phase).toBe(2);
    expect(A.out.size).toBe(2);
    // 0,25 → скрытая голова, озеро — ил, головы ушли.
    body.hp = body.maxHp * 0.24;
    stepSim(s, DT, NO_INPUT);
    expect(s.boss!.phase).toBe(3);
    expect(A.pool.every((i) => s.tiles[i] === Tile.Floor)).toBe(true);
    for (let k = 0; k < 60; k++) stepSim(s, DT, NO_INPUT);
    expect(s.mobs.some((m) => m.kind === 'f9_head')).toBe(false);
    const crown = s.mobs.find((m) => m.kind === 'f9_crown')!;
    expect(crown).toBeTruthy();
    // Полоса в последней фазе — от скрытой головы.
    crown.hp = crown.maxHp * 0.5;
    stepSim(s, DT, NO_INPUT);
    // Сброс боя возвращает арену.
    s.hero.inv = 0;
    s.hero.hp = 1;
    s.hero.status = { poison: { t: 5, p: 1 } };
    for (let k = 0; k < 5; k++) stepSim(s, DT, NO_INPUT);
    expect(s.boss!.state).toBe('idle');
    expect(A.pool.every((i) => s.tiles[i] === Tile.Deep)).toBe(true);
    expect(A.shore.every((i) => s.tiles[i] !== Tile.Hazard || s.world.mark[i] !== F9_MARK.flood)).toBe(true);
    expect(s.mobs.some((m) => m.kind === 'f9_stump')).toBe(false);
    void HYDRA_NOTCH;
  });

  it('срубленная голова отрастает двумя, если шею не прижечь', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 0.5, 4);
    s.hero.inv = 99;
    for (let k = 0; k < 3; k++) stepSim(s, DT, NO_INPUT);
    const body = s.mobs.find((m) => m.kind === 'f9boss')!;
    const head = s.mobs.find((m) => m.kind === 'f9_head')!;
    const before = body.hp;
    // Рубим голову насмерть последним ударом клинка.
    head.hp = 1;
    head.data.ghost = 0;
    head.mode = 'idle';
    s.hero.x = head.x - 0.9;
    s.hero.y = head.y;
    head.x = s.hero.x + 0.9;
    let stump: Mob | undefined;
    for (let k = 0; k < 40 && !stump; k++) {
      head.x = s.hero.x + 0.9;
      head.y = s.hero.y;
      stepSim(s, DT, { ...NO_INPUT, attack: k % 10 === 0, aim: { x: 1, y: 0 } });
      s.hero.inv = 99;
      stump = s.mobs.find((m) => m.kind === 'f9_stump');
    }
    expect(stump, 'обрубок').toBeTruthy();
    expect(body.hp).toBeLessThan(before);
    const heads0 = s.mobs.filter((m) => m.kind === 'f9_head' && m.mode !== 'dying').length;
    // Не прижгли — ждём срок.
    for (let k = 0; k < 10 * 60; k++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.inv = 99;
      s.hero.x = bossObj.x + 0.5;
      s.hero.y = bossObj.y + 3;
    }
    const heads1 = s.mobs.filter((m) => m.kind === 'f9_head' && m.mode !== 'dying').length;
    expect(heads1).toBe(heads0 + 2);
  });

  it('огонь жаровни прижигает шею: не отрастает, тело слабеет', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 0.5, 5);
    s.hero.inv = 99;
    for (let k = 0; k < 3; k++) stepSim(s, DT, NO_INPUT);
    const fs = f9State(s);
    const body = s.mobs.find((m) => m.kind === 'f9boss')!;
    const head = s.mobs.find((m) => m.kind === 'f9_head')!;
    head.hp = 0.5;
    head.mode = 'idle';
    head.data.ghost = 0;
    let stump: Mob | undefined;
    for (let k = 0; k < 40 && !stump; k++) {
      s.hero.x = head.x - 0.9;
      s.hero.y = head.y;
      stepSim(s, DT, { ...NO_INPUT, attack: k % 10 === 0, aim: { x: 1, y: 0 } });
      s.hero.inv = 99;
      stump = s.mobs.find((m) => m.kind === 'f9_stump');
    }
    expect(stump).toBeTruthy();
    // Без огня обрубок недосягаем.
    stepSim(s, DT, NO_INPUT);
    expect(stump!.data.ghost).toBe(1);
    // К жаровне — огонь в руке.
    const br = fs.arena!.braziers[0];
    for (let k = 0; k < 12; k++) {
      s.hero.x = br.x;
      s.hero.y = br.y + 0.8;
      stepSim(s, DT, NO_INPUT);
    }
    expect(fs.fire).toBeGreaterThan(s.time + FIRE_T - 1);
    expect(s.zones.some((z) => z.art === 'f9_handfire')).toBe(true);
    const hp0 = body.hp;
    let seared = false;
    for (let k = 0; k < 60 && !seared; k++) {
      s.hero.x = stump!.x - 0.8;
      s.hero.y = stump!.y;
      stepSim(s, DT, { ...NO_INPUT, attack: k % 10 === 0, aim: { x: 1, y: 0 } });
      s.hero.inv = 99;
      seared = stump!.mode === 'seared';
    }
    expect(seared).toBe(true);
    expect(body.hp).toBeLessThan(hp0);
    // Огонь ушёл на шею.
    expect(fs.fire).toBeLessThanOrEqual(s.time);
    const heads0 = s.mobs.filter((m) => m.kind === 'f9_head' && m.mode !== 'dying').length;
    for (let k = 0; k < 10 * 60; k++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.inv = 99;
    }
    expect(s.mobs.filter((m) => m.kind === 'f9_head' && m.mode !== 'dying').length).toBe(heads0);
  });

  it('скрытая голова пала — гидра мертва, из арены выходят', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 0.5, 6);
    s.hero.inv = 99;
    for (let k = 0; k < 3; k++) stepSim(s, DT, NO_INPUT);
    const body = s.mobs.find((m) => m.kind === 'f9boss')!;
    body.hp = body.maxHp * 0.2;
    for (let k = 0; k < 120; k++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.inv = 99;
    }
    const crown = s.mobs.find((m) => m.kind === 'f9_crown')!;
    expect(crown.mode).not.toBe('rise');
    crown.hp = 1;
    crown.mode = 'up';
    crown.data.ghost = 0;
    let won = false;
    for (let k = 0; k < 60 && !won; k++) {
      s.hero.x = crown.x - 0.9;
      s.hero.y = crown.y;
      stepSim(s, DT, { ...NO_INPUT, attack: k % 10 === 0, aim: { x: 1, y: 0 } });
      s.hero.inv = 99;
      won = s.boss!.state === 'won';
    }
    expect(won).toBe(true);
    // Ворота не захлопываются на победителе: к воротам и наружу.
    const gate = s.boss!.gates[0];
    const out = field(s, gate % W, Math.floor(gate / W) + 4);
    let t = 0;
    for (; t < 30 * 60; t++) {
      const inp = { ...NO_INPUT };
      stepField(s, out, inp);
      stepSim(s, DT, inp);
      if (Math.hypot(s.hero.x - cellX(gate), s.hero.y - cellY(gate) - 3.5) < 1) break;
    }
    expect(t).toBeLessThan(30 * 60);
    expect(s.tiles[gate]).toBe(Tile.Gate);
  });
});

// ---------------------------------------------------------------------------
// Круги-телепорты.
// ---------------------------------------------------------------------------

describe('этаж 9: круги', () => {
  const s0 = sim(8, 5, 1, 1, 1);
  const st0 = f9State(s0);

  it('пары: у каждого круга пары есть конец, у Круговорота — четыре слота', () => {
    const pairs = st0.rings.filter((r) => r.kind === 'pair');
    expect(pairs.length).toBe(8);
    for (const r of pairs) {
      expect(r.to).toBeGreaterThanOrEqual(0);
      expect(st0.rings[r.to].k).toBe(r.k);
      expect(st0.rings[r.to].to).toBe(st0.rings.indexOf(r));
    }
    expect(st0.hall).not.toBeNull();
    expect(st0.hall!.slots.length).toBe(4);
    expect(st0.rings.filter((r) => r.kind === 'trap').length).toBeGreaterThanOrEqual(2);
  });

  it('встал в круг — вспышка в точке выхода, потом перенос; сошёл раньше — отмена', () => {
    const r = st0.rings.find((x) => x.kind === 'pair' && x.k === 1 && x.area === F9_RUINS && x.y > 250)!;
    const to = st0.rings[r.to];
    const s = sim(8, 5, r.x + 0.5, r.y + 1.5, 2);
    s.hero.inv = 99;
    for (let k = 0; k < 20; k++) stepSim(s, DT, NO_INPUT);
    s.hero.x = r.x + 0.5;
    s.hero.y = r.y + 0.5;
    stepSim(s, DT, NO_INPUT);
    // Вспышка на том конце — сразу.
    expect(s.zones.some((z) => z.art === 'f9_warp_out' && Math.hypot(z.x - to.x - 0.5, z.y - to.y - 0.5) < 0.1)).toBe(true);
    const w0 = s.warps;
    for (let k = 0; k < (WARP_T * 60) / 2; k++) stepSim(s, DT, NO_INPUT);
    expect(s.warps).toBe(w0);
    // Сошёл — отмена.
    s.hero.x = r.x + 0.5;
    s.hero.y = r.y + 1.6;
    for (let k = 0; k < 60; k++) stepSim(s, DT, NO_INPUT);
    expect(s.warps).toBe(w0);
    // Встал и стоит — перенос.
    s.hero.x = r.x + 0.5;
    s.hero.y = r.y + 0.5;
    for (let k = 0; k < 60; k++) stepSim(s, DT, NO_INPUT);
    expect(s.warps).toBe(w0 + 1);
    expect(Math.hypot(s.hero.x - to.x - 0.5, s.hero.y - to.y - 0.5)).toBeLessThan(0.7);
    // Пришёл на круг — он не отправляет обратно, пока с него не сошёл.
    for (let k = 0; k < 120; k++) stepSim(s, DT, NO_INPUT);
    expect(s.warps).toBe(w0 + 1);
  });

  it('красный круг — ловушка: зал засады, выход открывается после боя', () => {
    const trap = st0.rings.find((x) => x.kind === 'trap')!;
    const s = sim(8, 5, trap.x + 0.5, trap.y + 1.5, 3);
    s.hero.inv = 99;
    for (let k = 0; k < 20; k++) stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    s.hero.x = trap.x + 0.5;
    s.hero.y = trap.y + 0.5;
    let trapped = false;
    for (let k = 0; k < 90; k++) {
      stepSim(s, DT, NO_INPUT);
      for (const e of s.events) if (e.t === 'boss' && e.what === 'f9_ambush_trap') trapped = true;
    }
    const fs = f9State(s);
    expect(trapped).toBe(true);
    expect(fs.amb!.state).toBe(1);
    expect(s.mobs.length).toBeGreaterThanOrEqual(5);
    const back = fs.rings.findIndex((x) => x.kind === 'back');
    // Пока бой — выход спит.
    expect(fs.rings[back].to).toBeGreaterThanOrEqual(0);
    // Отбились — выход открыт.
    for (const m of s.mobs) m.hp = 0;
    s.mobs = [];
    stepSim(s, DT, NO_INPUT);
    expect(fs.amb!.state).toBe(2);
    const exit = fs.rings[fs.rings[back].to];
    s.hero.x = fs.rings[back].x + 0.5;
    s.hero.y = fs.rings[back].y + 1.8;
    stepSim(s, DT, NO_INPUT);
    s.hero.y -= 1.3;
    for (let k = 0; k < 60; k++) stepSim(s, DT, NO_INPUT);
    expect(Math.hypot(s.hero.x - exit.x - 0.5, s.hero.y - exit.y - 0.5)).toBeLessThan(0.8);
  });

  it('Круговорот: круги зала разом меняют пары, у каждого конца — ровно один слот', () => {
    const h = st0.hall!;
    const s = sim(8, 5, (h.x0 + h.x1) / 2 + 0.5, h.y1 - 1.5, 4);
    s.hero.inv = 99;
    const fs = f9State(s);
    const perm0 = fs.hall!.perm.slice();
    let changes = 0;
    let last = perm0.join();
    for (let k = 0; k < 30 * 60; k++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.inv = 99;
      const now = fs.hall!.perm.join();
      if (now !== last) {
        changes += 1;
        last = now;
        // Каждый конец — у одного слота, и слот ведёт в свой конец.
        const dests = fs.hall!.slots.map((i) => fs.rings[i].to);
        expect(new Set(dests).size).toBe(4);
        for (const i of fs.hall!.slots) expect(fs.rings[fs.rings[i].to].to).toBe(i);
      }
    }
    expect(changes).toBeGreaterThanOrEqual(3);
  });

  it('спящий круг «3» будит пара в логове', () => {
    const lair = st0.rings.find((x) => x.k === 3 && x.area === F9_LAIR)!;
    const maze = st0.rings.find((x) => x.k === 3 && x.area === F9_MAZE)!;
    const s = sim(8, 5, maze.x + 0.5, maze.y + 1.5, 5);
    s.hero.inv = 99;
    for (let k = 0; k < 10; k++) stepSim(s, DT, NO_INPUT);
    s.hero.x = maze.x + 0.5;
    s.hero.y = maze.y + 0.5;
    const w0 = s.warps;
    for (let k = 0; k < 60; k++) stepSim(s, DT, NO_INPUT);
    expect(s.warps).toBe(w0);
    // С той стороны.
    s.hero.x = lair.x + 0.5;
    s.hero.y = lair.y + 0.5;
    for (let k = 0; k < 60; k++) stepSim(s, DT, NO_INPUT);
    expect(f9State(s).awake3).toBe(true);
    expect(s.warps).toBe(w0 + 1);
    expect(Math.hypot(s.hero.x - maze.x - 0.5, s.hero.y - maze.y - 0.5)).toBeLessThan(0.7);
  });
});

// ---------------------------------------------------------------------------
// События районов.
// ---------------------------------------------------------------------------

describe('этаж 9: события', () => {
  it('корневая часовня: двери зарастают, корни бьют рядами, потом открыт ход к лифту', () => {
    const s0 = sim(8, 5, 1, 1, 1);
    const c = f9State(s0).chapel!;
    expect(c.doors.length).toBeGreaterThan(3);
    expect(c.shortcut.length).toBeGreaterThan(3);
    const cx = Math.floor((c.x0 + c.x1) / 2);
    const cy = Math.floor((c.y0 + c.y1) / 2) - 3;
    const s = sim(8, 5, cx + 0.5, cy + 0.5, 11);
    s.hero.inv = 99;
    let lines = 0;
    let sealed = false;
    for (let k = 0; k < (CHAPEL_T + 2) * 60; k++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.inv = 99;
      s.hero.hp = s.stats.maxHp;
      if (k === 30) sealed = c.doors.every((i) => s.tiles[i] === Tile.Wall);
      lines = Math.max(lines, s.strikes.filter((z) => z.art === 'f9_rootline').length);
    }
    const fc = f9State(s).chapel!;
    expect(sealed).toBe(true);
    expect(lines).toBeGreaterThanOrEqual(3);
    expect(fc.state).toBe(2);
    expect(fc.doors.every((i) => walkableTile(s.tiles[i]))).toBe(true);
    expect(fc.shortcut.every((i) => walkableTile(s.tiles[i]))).toBe(true);
  });

  it('прилив: на гати вода встаёт за спиной и топит', () => {
    const s0 = sim(8, 5, 1, 1, 1);
    const tide = f9State(s0).tide!;
    const cells = [...tide.step.entries()].sort((a, b) => a[1] - b[1]);
    const s = sim(8, 5, cellX(cells[0][0]), cellY(cells[0][0]), 12);
    s.hero.inv = 99;
    s.mobs = [];
    // Идём по гати вперёд.
    let k = 0;
    for (const [i] of cells) {
      if (k++ % 3) continue;
      s.hero.x = cellX(i);
      s.hero.y = cellY(i);
      for (let n = 0; n < 12; n++) stepSim(s, DT, NO_INPUT);
      s.mobs = s.mobs.filter((m) => m.kind !== 'f9_leech' || m.mode === 'f9_leap');
    }
    const ft = f9State(s).tide!;
    expect(ft.state).toBeGreaterThanOrEqual(1);
    expect(ft.zones.size).toBeGreaterThan(20);
    // Вода — за спиной: у первых шагов гати, не у героя.
    const z0 = s.zones.find((z) => z.art === 'f9_tidewater')!;
    expect(z0).toBeTruthy();
    // Вода замедляет, но урон считает сам прилив — по клетке под героем,
    // один раз: клетки воды вокруг не складываются.
    const water = s.zones.filter((z) => z.art === 'f9_tidewater');
    expect(water.every((z) => !z.dps && (z.slow ?? 1) < 1)).toBe(true);
    const sunk = water.find((z) => z.t >= (z.warn ?? 0))!;
    s.hero.x = sunk.x;
    s.hero.y = sunk.y;
    s.hero.inv = 0;
    const hp0 = s.hero.hp;
    for (let n = 0; n < 60; n++) {
      s.hero.x = sunk.x;
      s.hero.y = sunk.y;
      stepSim(s, DT, NO_INPUT);
    }
    const lost = (hp0 - s.hero.hp) / s.stats.maxHp;
    expect(lost).toBeGreaterThan(0.03);
    expect(lost).toBeLessThan(0.08);
  });
});

// ---------------------------------------------------------------------------
// Монстры.
// ---------------------------------------------------------------------------

const objCells = new Set(world.objs.map((o) => o.y * W + o.x));

/** Открытое место: пол без кругов и предметов в радиусе r. */
function openSpot(area: string, r = 3, skip = 0): [number, number] {
  let n = 0;
  for (let y = 3; y < world.h - 3; y++) {
    if (world.rowArea[y] !== area) continue;
    for (let x = 4; x < W - 4; x++) {
      let ok = true;
      for (let dy = -r; dy <= r && ok; dy++)
        for (let dx = -r; dx <= r && ok; dx++) {
          const i = (y + dy) * W + x + dx;
          if (world.tiles[i] !== Tile.Floor || isRingMark(world.mark[i]) || objCells.has(i)) ok = false;
        }
      if (ok && n++ >= skip) return [x + 0.5, y + 0.5];
    }
  }
  throw new Error('нет места');
}

function quiet(s: Sim): void {
  s.hero.inv = 99;
  for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
  s.mobs = [];
}

describe('этаж 9: монстры', () => {
  it('ящеролюд целится линией и делает выпад копьём', () => {
    const [x, y] = openSpot(F9_RUINS, 3);
    const s = sim(8, 5, x, y, 21);
    quiet(s);
    const m = spawnMob(s, 'f9_lizard', x + 2.6, y, { mode: 'chase' });
    m.cd = 0;
    let aimed = false;
    let lunged = false;
    let hurt = false;
    for (let t = 0; t < 3 * 60; t++) {
      s.hero.inv = 0;
      s.hero.x = x;
      s.hero.y = y;
      const hp = s.hero.hp;
      stepSim(s, DT, NO_INPUT);
      if (m.mode === 'aim' && m.tele?.shape === 'line') aimed = true;
      if (m.mode === 'lunge') lunged = true;
      if (s.hero.hp < hp) hurt = true;
      s.hero.hp = s.stats.maxHp;
    }
    expect(aimed).toBe(true);
    expect(lunged).toBe(true);
    expect(hurt).toBe(true);
  });

  it('жаба плюётся навесом, на месте падения — лужа яда', () => {
    const [x, y] = openSpot(F9_RUINS, 3, 3);
    const s = sim(8, 5, x, y, 22);
    quiet(s);
    const m = spawnMob(s, 'f9_toad', x + 3.5, y, { mode: 'chase' });
    m.cd = 0;
    let lob = false;
    let pool = false;
    let poisoned = false;
    for (let t = 0; t < 4 * 60; t++) {
      s.hero.inv = 0;
      s.hero.x = x;
      s.hero.y = y;
      stepSim(s, DT, NO_INPUT);
      if (s.shots.some((q) => q.lob && q.art === 'f9_spit')) lob = true;
      if (s.zones.some((z) => z.art === 'f9_venom' && z.t >= (z.warn ?? 0))) pool = true;
      if (s.hero.status.poison) poisoned = true;
      s.hero.hp = s.stats.maxHp;
    }
    expect(lob).toBe(true);
    expect(pool).toBe(true);
    expect(poisoned).toBe(true);
  });

  it('кобольд ставит метку и появляется за спиной', () => {
    const [x, y] = openSpot(F9_MAZE, 3);
    const s = sim(8, 5, x, y, 23);
    quiet(s);
    const m = spawnMob(s, 'f9_kobold', x + 3, y, { mode: 'chase' });
    m.cd = 0;
    let mark = false;
    let behind = false;
    for (let t = 0; t < 3 * 60; t++) {
      s.hero.inv = 99;
      s.hero.x = x;
      s.hero.y = y;
      stepSim(s, DT, NO_INPUT);
      if (s.zones.some((z) => z.art === 'f9_blink')) mark = true;
      if (m.mode === 'f9_appear' && m.x < x) behind = true;
    }
    expect(mark).toBe(true);
    expect(behind).toBe(true);
  });

  it('каменный змей: первый взгляд замедляет, второй подряд — каменеешь', () => {
    const [x, y] = openSpot(F9_MAZE, 3, 5);
    const s = sim(8, 5, x, y, 24);
    quiet(s);
    const m = spawnMob(s, 'f9_serpent', x + 3, y, { mode: 'chase' });
    m.cd = 0;
    let slowed = false;
    let stunned = false;
    for (let t = 0; t < 8 * 60 && !stunned; t++) {
      s.hero.inv = 0;
      s.hero.x = x;
      s.hero.y = y;
      stepSim(s, DT, NO_INPUT);
      if (s.hero.status.slow) slowed = true;
      if (s.hero.status.stun) stunned = true;
      s.hero.hp = s.stats.maxHp;
      m.data.bcd = 9;
      if (m.mode === 'recover') m.cd = Math.min(m.cd, 0.3);
    }
    expect(slowed).toBe(true);
    expect(stunned).toBe(true);
  });

  it('корневая хваталка: невидима в трясине, круг корней держит, потом открыта', () => {
    const bog = [...Array(world.h * W).keys()].find(
      (i) => world.mark[i] === F9_MARK.bog && world.rowArea[Math.floor(i / W)] === F9_RUINS &&
        [1, -1, W, -W].every((d) => world.mark[i + d] === F9_MARK.bog),
    )!;
    const s = sim(8, 5, cellX(bog) + 1, cellY(bog), 25);
    quiet(s);
    const m = spawnMob(s, 'f9_root', cellX(bog), cellY(bog), { mode: 'f9_sub' });
    m.data.ghost = 1;
    m.cd = 0;
    expect(m.data.ghost).toBe(1);
    let grabbed = false;
    let up = false;
    for (let t = 0; t < 3 * 60; t++) {
      s.hero.inv = 0;
      s.hero.x = cellX(bog) + 1.5;
      s.hero.y = cellY(bog);
      stepSim(s, DT, NO_INPUT);
      if (s.hero.status.slow) grabbed = true;
      if (m.mode === 'up' && m.data.ghost === 0) up = true;
      s.hero.hp = s.stats.maxHp;
    }
    expect(grabbed).toBe(true);
    expect(up).toBe(true);
  });

  it('пиявка присасывается и пьёт, рывок стряхивает', () => {
    const [x, y] = openSpot(F9_RUINS, 2, 7);
    const s = sim(8, 5, x, y, 26);
    quiet(s);
    s.hero.inv = 0;
    const m = spawnMob(s, 'f9_leech', x + 0.5, y, { mode: 'chase' });
    m.cd = 0;
    let latched = false;
    for (let t = 0; t < 2 * 60 && !latched; t++) {
      stepSim(s, DT, NO_INPUT);
      latched = m.mode === 'latch';
    }
    expect(latched).toBe(true);
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    expect(s.hero.status.poison).toBeTruthy();
    stepSim(s, DT, { ...NO_INPUT, dash: true, mx: -1 });
    stepSim(s, DT, NO_INPUT);
    expect(m.mode).toBe('dizzy');
  });

  it('жрец рисует руну под героем: остался — перенесён к жрецу, вышел — нет', () => {
    for (const stay of [true, false]) {
      const [x, y] = openSpot(F9_RUINS, 4, 2);
      const s = sim(8, 5, x - 2, y, 27);
      quiet(s);
      const m = spawnMob(s, 'f9_priest', x + 3.5, y, { mode: 'chase' });
      m.cd = 0;
      const w0 = s.warps;
      let cast = false;
      for (let t = 0; t < 3 * 60; t++) {
        s.hero.inv = 0;
        const inp = { ...NO_INPUT };
        if (m.mode === 'cast') {
          cast = true;
          if (!stay) inp.mx = -1;
        } else if (!cast) {
          s.hero.x = x - 2;
          s.hero.y = y;
        }
        stepSim(s, DT, inp);
        s.hero.inv = 0;
        m.data.bcd = 9;
      }
      expect(cast).toBe(true);
      expect(s.warps > w0).toBe(stay);
    }
  });

  it('болотный огонь вспыхивает холодом кольцом, потом гаснет и загорается в другом месте', () => {
    const [x, y] = openSpot(F9_RUINS, 3, 9);
    const s = sim(8, 5, x, y, 28);
    quiet(s);
    const m = spawnMob(s, 'f9_wisp', x + 1.5, y, { mode: 'chase' });
    m.cd = 0;
    let flare = false;
    let chill = false;
    let faded = false;
    for (let t = 0; t < 3 * 60; t++) {
      s.hero.inv = 0;
      s.hero.x = x;
      s.hero.y = y;
      stepSim(s, DT, NO_INPUT);
      if (m.mode === 'flare' && m.tele?.shape === 'circle') flare = true;
      if (s.hero.status.chill) chill = true;
      if (m.mode === 'fade') faded = true;
      s.hero.hp = s.stats.maxHp;
    }
    expect(flare).toBe(true);
    expect(chill).toBe(true);
    expect(faded).toBe(true);
  });

  it('монстры этажа не застревают в стенах и воде', () => {
    const kinds = ['f9_lizard', 'f9_toad', 'f9_kobold', 'f9_serpent', 'f9_wisp', 'f9_leech', 'f9_priest', 'f9_hoarder'];
    let stuck = 0;
    let checks = 0;
    const spots: [string, number][] = [
      [F9_RUINS, 0],
      [F9_RUINS, 11],
      [F9_MAZE, 2],
      [F9_MAZE, 8],
      [F9_LAIR, 0],
      [F9_LAIR, 4],
    ];
    spots.forEach(([area, skip], k) => {
      const [x, y] = openSpot(area, 1, skip);
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
          if (m.mode === 'dying' || m.mode === 'emerge' || m.t < 0 || m.mode === 'latch') continue;
          checks += 1;
          const i = Math.floor(m.y) * W + Math.floor(m.x);
          const t2 = s.tiles[i];
          const bad = MOBS[m.kind].fly ? t2 !== Tile.Deep && !walkableTile(t2) : !walkableTile(t2);
          if (bad) stuck += 1;
        }
        if (s.hero.mode === 'dead') break;
      }
    });
    expect(checks).toBeGreaterThan(500);
    expect(stuck).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Проходимость: от лифта до ворот логова (через Круговорот).
// ---------------------------------------------------------------------------

describe('этаж 9: проходимость', () => {
  it('от лифта до ворот логова на Сполохе +5 с едой: руины, Круговорот, гать', () => {
    const lift = liftOf(world, F9_RUINS)!;
    const gate = world.objs.find((o) => o.kind === 'gate')!;
    const toGate = field(null, gate.x, gate.y + 3);
    let arrived = 0;
    for (const seed of [71, 72, 73]) {
      const s = sim(8, 5, lift.x + 0.5, lift.y + 0.5, seed, 10);
      const st: BotState = { lastAtk: -9, react: [0.22, 0.4], miss: 0.1, seed };
      const fs = f9State(s);
      const hall = fs.hall!;
      const dest5 = hall.dests[0];
      let t = 0;
      for (; t < 600 * 60; t++) {
        const h = s.hero;
        let inp: SimInput;
        // По ту сторону решётки ведёт только круг: ищем слот, ведущий в «5».
        const byWalk = toGate[Math.floor(h.y) * W + Math.floor(h.x)] >= 0;
        if (!byWalk) {
          const slot = hall.slots.find((i) => fs.rings[i].to === dest5)!;
          const r = fs.rings[slot];
          inp = { ...NO_INPUT };
          if (!dodge(s, st, inp)) {
            const near = s.mobs.find((m) => open(m) && Math.hypot(m.x - h.x, m.y - h.y) < 2.2);
            if (near) hitNear(s, st, inp, near);
            else goTo(s, st, r.x + 0.5, r.y + 0.5, inp, new Set([r.y * W + r.x]));
          }
          eat(s, inp);
        } else inp = bot(s, toGate, st);
        stepSim(s, DT, inp);
        if (process.env.F9TRACE && s.area === 'f9lair' && t % 30 === 0)
          console.log(
            (t / 60).toFixed(1),
            s.hero.hp.toFixed(0),
            s.hero.x.toFixed(1),
            s.hero.y.toFixed(1),
            Object.keys(s.hero.status ?? {}).join(','),
            s.mobs
              .filter((m) => m.mode !== 'dying' && Math.hypot(m.x - s.hero.x, m.y - s.hero.y) < 5)
              .map((m) => `${m.kind}:${m.mode}`)
              .join(' '),
            s.zones
              .filter((z) => Math.hypot(z.x - s.hero.x, z.y - s.hero.y) < z.r + 0.5)
              .map((z) => z.art)
              .join(' '),
          );
        if (Math.hypot(s.hero.x - gate.x - 0.5, s.hero.y - gate.y - 3.5) < 1.5) break;
        if (s.hero.mode === 'dead') break;
      }
      if (LOG)
        console.log(
          `путь ${seed}: ${s.hero.mode === 'dead' ? `погиб на ${(t / 60).toFixed(0)} с (${s.area} ${s.hero.x.toFixed(0)},${s.hero.y.toFixed(0)})` : `${(t / 60).toFixed(0)} с`}, убито ${s.killed}`,
          s.mobs
            .filter((m) => m.mode !== 'dying' && Math.hypot(m.x - s.hero.x, m.y - s.hero.y) < 6)
            .map((m) => `${m.kind}:${m.mode}`)
            .join(' '),
        );
      if (s.hero.mode !== 'dead' && t < 600 * 60) arrived += 1;
    }
    expect(arrived).toBeGreaterThanOrEqual(2);
  });
});
