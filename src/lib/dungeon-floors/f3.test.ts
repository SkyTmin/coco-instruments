// Этаж 3 «Затопленная бездна»: карта, монстры, проклятие подъёма и Алая
// пасть — ботом на настоящем `stepSim`. Бот — живой игрок средней руки:
// видит метки на полу и уворачивается с задержкой реакции, бьёт ближнего,
// ест, когда здоровья меньше 40%.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { createSim, NO_INPUT, spawnMob, stepSim, strikeHits, SWORD } from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import {
  bandOf,
  buildWorld,
  liftOf,
  reachable,
  Tile,
  tileAt,
  walkableTile,
} from '../dungeon-world';
import { F3, F3_MARK } from './f3';
import { curseLayer, sackFill } from './f3-brains';
import { MAP_F3_DEPTH, MAP_F3_RIM } from './f3-map';

const world = buildWorld(3);
const W = world.w;
const DT = 1 / 60;

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 3, lifts: [...DUNGEON_START.lifts, 'f3rim'] };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7): Sim {
  const d = dungeon(tier, plus);
  return createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
}

/** Поле расстояний по полу до клетки — бот идёт по нему. */
function field(tx: number, ty: number): Int32Array {
  const f = new Int32Array(W * world.h).fill(-1);
  const q = [ty * W + tx];
  f[q[0]] = 0;
  while (q.length) {
    const i = q.shift()!;
    for (const j of [i + 1, i - 1, i + W, i - W]) {
      const t = world.tiles[j];
      if (j < 0 || j >= f.length || f[j] >= 0 || !(walkableTile(t) || t === Tile.Gate)) continue;
      f[j] = f[i] + 1;
      q.push(j);
    }
  }
  return f;
}

const ghost = (m: Mob) =>
  m.mode === 'dying' || m.mode === 'emerge' || m.mode === 'escape' || (m.data.ghost ?? 0) > 0;

/** Попадает ли метка моба (`tele`) по кругу героя. */
function teleHits(m: Mob, x: number, y: number, r: number): boolean {
  const t = m.tele;
  if (!t) return false;
  return strikeHits(
    {
      shape: t.shape,
      x: t.x ?? m.x,
      y: t.y ?? m.y,
      r: t.r,
      w: t.w,
      ang: t.ang,
      arc: t.arc,
      warn: 0,
      dmg: 0,
    },
    x,
    y,
    r,
  );
}

interface BotState {
  lastAtk: number;
  /** Замеченные угрозы: когда увидел, через сколько отреагирует, «проспит» ли рывок. */
  plans: Map<string, { at: number; react: number; fumble: boolean }>;
  rnd: () => number;
}

function botState(seed: number): BotState {
  let x = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
  return { lastAtk: -9, plans: new Map(), rnd };
}

/**
 * Бот этажа — живой игрок средней руки. Каждую угрозу на полу замечает не
 * сразу (0,3–0,6 с), уходит от неё, а в последний миг — рывком; иногда
 * рывок «просыпает» (каждый пятый). Увлёкшись серией по открытому врагу,
 * уходит только в последний миг. Пока Алая пасть под водой — держится
 * подальше от кромки.
 */
function bot(s: Sim, goal: Int32Array | null, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (ghost(m)) continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  const busy = !!near && nd < SWORD.reach + near.r + 0.1 && h.mode === 'attack';
  const plan = (key: string) => {
    let p = st.plans.get(key);
    if (!p) {
      p = { at: s.time, react: 0.3 + st.rnd() * 0.3, fumble: st.rnd() < 0.2 };
      st.plans.set(key, p);
    }
    return p;
  };
  if (st.plans.size > 64) for (const [k, p] of st.plans) if (s.time - p.at > 6) st.plans.delete(k);
  /** Реагировать ли на угрозу: заметил ли, не увлёкся ли серией. */
  const react = (key: string, left: number) => {
    const p = plan(key);
    if (s.time - p.at < p.react) return null;
    if (busy && left > 0.25) return null;
    return p;
  };
  const flee = (fx: number, fy: number, dash: boolean, side = 0) => {
    let a = Math.atan2(h.y - fy, h.x - fx) + side;
    // Если сзади стена или вода — вбок.
    for (const d of [0, 0.8, -0.8, 1.6, -1.6, Math.PI]) {
      const x = h.x + Math.cos(a + d) * 0.9;
      const y = h.y + Math.sin(a + d) * 0.9;
      if (walkableTile(s.tiles[Math.floor(y) * W + Math.floor(x)])) {
        a += d;
        break;
      }
    }
    inp.mx = Math.cos(a);
    inp.my = Math.sin(a);
    if (dash && h.dashCd <= 0) inp.dash = true;
  };
  // Удары по площади: круг, конус, линия.
  for (const k of s.strikes) {
    if (!strikeHits(k, h.x, h.y, h.r + 0.35)) continue;
    const left = k.warn - k.t;
    const p = react(`s${k.id}`, left);
    if (!p) continue;
    const side =
      k.shape === 'cone'
        ? Math.sin((k.ang ?? 0) - Math.atan2(h.y - k.y, h.x - k.x)) > 0
          ? -1.3
          : 1.3
        : 0;
    flee(k.x, k.y, left < 0.3 && !p.fumble, side);
    return inp;
  }
  // Метки мобов: пике, разгон, хват; замах в ближнем бою.
  for (const m of s.mobs) {
    const key = `m${m.id}:${Math.round((s.time - m.t) * 20)}`;
    if (m.tele && teleHits(m, h.x, h.y, h.r + 0.3)) {
      const p = react(key, m.danger > 0 ? 0.2 : 1);
      if (!p) continue;
      flee(
        m.tele.x ?? m.x,
        m.tele.y ?? m.y,
        m.danger > 0 && !p.fumble,
        m.tele.shape === 'line' ? 1.5 : 0,
      );
      return inp;
    }
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (m.mode === 'windup' && d < MOBS[m.kind].reach + m.r + 1) {
      const left = MOBS[m.kind].windup - m.t;
      const p = react(key, left);
      if (!p) continue;
      flee(m.x, m.y, left < 0.3 && !p.fumble, 0.9);
      return inp;
    }
  }
  // Навесные плевки — прочь от места падения.
  for (const sh of s.shots) {
    if (!sh.lob) continue;
    const d = Math.hypot(sh.lob.x1 - h.x, sh.lob.y1 - h.y);
    if (d > sh.r + h.r + 0.3) continue;
    const p = react(`p${sh.id}`, sh.lob.T - sh.age);
    if (!p) continue;
    flee(sh.lob.x1, sh.lob.y1, sh.lob.T - sh.age < 0.3 && !p.fumble);
    return inp;
  }
  // Ледяные облака.
  for (const z of s.zones) {
    if (!z.status) continue;
    if (Math.hypot(z.x - h.x, z.y - h.y) < z.r + 0.4) {
      flee(z.x, z.y, false);
      return inp;
    }
  }
  const meat = Object.values(s.sack.meat).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free') inp.eat = true;
  // В пути — идёт и отбивается на ходу; в бою — подходит к врагу.
  if (near && nd < (goal ? 1.9 : 8)) {
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    if (nd > SWORD.reach * 0.8 && !goal) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
    }
    if (nd < SWORD.reach + near.r && s.time - st.lastAtk > 0.14) {
      inp.attack = true;
      inp.aim = { x: Math.cos(a), y: Math.sin(a) };
      st.lastAtk = s.time;
    }
    if (!goal) return inp;
  }
  // Пасть под водой — отойти от кромки и ждать.
  if (!goal && s.mobs.some((m) => m.kind === 'f3_maw')) {
    let wx = 0;
    let wy = 0;
    let n = 0;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++)
        if (s.tiles[(Math.floor(h.y) + dy) * W + Math.floor(h.x) + dx] === Tile.Deep) {
          wx += dx;
          wy += dy;
          n++;
        }
    if (n) flee(h.x + wx / n, h.y + wy / n, false);
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

const boss = world.objs.find((o) => o.kind === 'boss')!;

/** Бой с Алой пастью от ворот: время победы или −1. */
function fight(tier: number, plus: number, seed: number, limit = 300) {
  const s = sim(tier, plus, boss.x + 0.5, boss.y + 3.5, seed);
  s.sack.meat.f3_fish = 8;
  const st = botState(seed);
  let won = -1;
  let splashes = 0;
  let minWarn = 9;
  for (let t = 0; t < limit * 60; t++) {
    stepSim(s, DT, bot(s, null, st));
    for (const k of s.strikes)
      if (k.art === 'f3_splash' && k.t === 0) {
        splashes++;
        minWarn = Math.min(minWarn, k.warn);
      }
    if (s.events.some((e) => e.t === 'boss' && e.what === 'dead')) {
      won = s.time;
      break;
    }
    if (s.hero.mode === 'dead') break;
  }
  return { won, s, splashes, minWarn };
}

describe('этаж 3: карта', () => {
  it('районы стыкуются: проход в тех же столбцах', () => {
    const top = MAP_F3_RIM[0];
    const bottom = MAP_F3_DEPTH[MAP_F3_DEPTH.length - 1];
    let shared = 0;
    for (let x = 0; x < W; x++) if (top[x] !== '#' && bottom[x] !== '#') shared += 1;
    expect(shared).toBeGreaterThanOrEqual(4);
  });

  it('от лифта достижимо всё: предметы, тайники, шахты, омуты с берега', () => {
    const lift = liftOf(world, 'f3rim')!;
    const seen = reachable(world, lift.x, lift.y);
    for (const o of world.objs) {
      if (o.kind === 'ambush' || o.kind === 'group' || o.kind === 'burrow') continue;
      const [x, y] = walkableTile(tileAt(world, o.x, o.y)) ? [o.x, o.y] : [o.x, o.y + 1];
      const ok = seen[y * W + x] === 1 || seen[o.y * W + o.x] === 1;
      if (!ok) throw new Error(`не достать: ${o.kind} ${o.id}`);
    }
  });

  it('лампы и шахты на стене, под ними пол; у нор есть выход', () => {
    for (const o of world.objs) {
      if (o.kind === 'lamp' || o.kind === 'mine') {
        expect(tileAt(world, o.x, o.y)).toBe(Tile.Wall);
        expect(walkableTile(tileAt(world, o.x, o.y + 1))).toBe(true);
      }
      if (o.kind === 'burrow') expect(o.out, o.id).toBeDefined();
    }
    expect(world.objs.filter((o) => o.kind === 'mine').length).toBe(2);
  });

  it('вода и пропасть: мостки через пропасть, мелководье вязнет', () => {
    const band = bandOf(world, 'f3rim')!;
    let abyss = 0;
    let bridge = 0;
    for (let y = band.top; y < band.top + band.h; y++)
      for (let x = 0; x < W; x++) {
        const mk = world.mark[y * W + x];
        if (mk === F3_MARK.abyss) abyss++;
        if (mk === F3_MARK.bridgeV) bridge++;
      }
    expect(abyss).toBeGreaterThan(300);
    expect(bridge).toBeGreaterThan(20);
    const shallow = world.hazards.find((h) => h.slow);
    expect(shallow?.slow).toBeLessThan(1);
  });
});

describe('этаж 3: проклятие подъёма', () => {
  // Главный штрек Затопленных уступов идёт прямо на юг — к лифту.
  const band = bandOf(world, 'f3depth')!;
  const startY = band.top + 90;
  const x = 31.5;

  function fillSack(s: Sim) {
    Object.assign(s.sack.mats, {
      f3_feather: 32,
      f3_spine: 32,
      f3_chitin: 32,
      f3_pearl: 32,
      'ore:4': 64,
      'ore:5': 64,
      'block:4': 16,
      'block:5': 16,
    });
    s.sack.meat.f3_fish = 32;
  }

  it('полный рюкзак на подъёме копит тягу: ноги вязнут', () => {
    const s = sim(6, 3, x, startY, 3);
    fillSack(s);
    expect(sackFill(s)).toBeGreaterThan(0.9);
    expect(curseLayer(s)).toBeGreaterThan(0.8);
    // Пять секунд на юг по штреку — до родника на уступах.
    for (let i = 0; i < 60 * 5; i++) {
      stepSim(s, DT, { ...NO_INPUT, my: 1 });
      s.mobs = [];
    }
    expect(s.floorData.strain).toBeGreaterThan(0.4);
    expect(s.hero.status.slow).toBeTruthy();
  });

  it('вглубь и на месте тяга спадает, у родника — быстрее всего', () => {
    const s = sim(6, 3, x, startY, 3);
    fillSack(s);
    s.floorData.strain = 0.9;
    for (let i = 0; i < 60 * 3; i++) stepSim(s, DT, { ...NO_INPUT, my: -1 });
    const walked = s.floorData.strain;
    expect(walked).toBeLessThan(0.9);
    for (let i = 0; i < 60 * 3; i++) stepSim(s, DT, NO_INPUT);
    expect(s.floorData.strain).toBeLessThan(walked - 0.3);
    // Родник у лифта.
    const spring = world.objs.find((o) => o.kind === 'deco' && o.ref === 'f3_spring')!;
    const t = sim(6, 3, spring.x + 0.5, spring.y + 0.5, 3);
    t.floorData.strain = 0.9;
    for (let i = 0; i < 60 * 1.5; i++) stepSim(t, DT, NO_INPUT);
    expect(t.floorData.strain).toBeLessThan(0.1);
  });

  it('пустой рюкзак тянет втрое слабее; спуск не тянет вовсе', () => {
    const run2 = (full: boolean, my: number) => {
      const s = sim(6, 3, x, my > 0 ? startY : band.top + 118, 3);
      if (full) fillSack(s);
      for (let i = 0; i < 60 * 4; i++) {
        stepSim(s, DT, { ...NO_INPUT, my });
        s.mobs = [];
      }
      return s.floorData.strain;
    };
    const full = run2(true, 1);
    const empty = run2(false, 1);
    expect(empty).toBeGreaterThan(0);
    expect(empty).toBeLessThan(full * 0.45);
    expect(run2(true, -1)).toBe(0);
  });

  it('полная тяга — приступ: оглушение, но не смерть', () => {
    const s = sim(6, 3, x, startY, 3);
    fillSack(s);
    s.hero.hp = 3;
    s.floorData.strain = 0.99;
    let stun = false;
    for (let i = 0; i < 60 * 3; i++) {
      stepSim(s, DT, { ...NO_INPUT, my: 1 });
      s.mobs = [];
      if (s.hero.status.stun) stun = true;
    }
    expect(stun).toBe(true);
    expect(s.hero.hp).toBeGreaterThan(0);
    expect(s.hero.mode).toBe('free');
  });
});

describe('этаж 3: монстры', () => {
  const rimBand = bandOf(world, 'f3rim')!;

  it('монстры не застревают в стенах; ходячие — не в воде, омутник — только в воде', () => {
    // Грот у лифта: вода, мелководье, друзы — всё, где им жить.
    const lift = liftOf(world, 'f3rim')!;
    for (const seed of [1, 2, 3]) {
      const s = sim(5, 5, lift.x + 0.5, rimBand.top + 72, seed);
      const kinds = ['f3_spear', 'f3_crab', 'f3_mocker', 'f3_jelly', 'f3_spear', 'f3_crab'];
      kinds.forEach((k, i) =>
        spawnMob(s, k, s.hero.x - 5 + i * 2, s.hero.y - 2 + (i % 2) * 3, { mode: 'chase' }),
      );
      const st = botState(seed);
      for (let t = 0; t < 40 * 60; t++) {
        stepSim(s, DT, bot(s, null, st));
        if (s.hero.mode === 'dead') break;
        if (t % 30) continue;
        for (const m of s.mobs) {
          if (m.mode === 'dying' || m.mode === 'emerge') continue;
          const tile = s.tiles[Math.floor(m.y) * W + Math.floor(m.x)];
          const def = MOBS[m.kind];
          expect(tile, `${m.kind} в стене`).not.toBe(Tile.Wall);
          if (m.kind === 'f3_grasp') expect(tile, 'омутник на суше').toBe(Tile.Deep);
          else if (!def.fly) expect(tile, `${m.kind} в воде`).not.toBe(Tile.Deep);
        }
      }
    }
  });

  it('омутник под водой недосягаем, хват виден за 0,5 с до удара', () => {
    // Омут грота: встаём у кромки.
    const pool = world.objs.length
      ? (() => {
          for (let y = rimBand.top + 60; y < rimBand.top + 80; y++)
            for (let x = 0; x < W; x++) if (world.mark[y * W + x] === F3_MARK.pool) return [x, y];
          return [0, 0];
        })()
      : [0, 0];
    let shore: [number, number] | null = null;
    for (let r = 1; r < 8 && !shore; r++)
      for (let dx = -r; dx <= r && !shore; dx++) {
        const x = pool[0] + dx;
        const y = pool[1] + r;
        if (walkableTile(world.tiles[y * W + x]) && world.tiles[(y - 1) * W + x] === Tile.Deep)
          shore = [x, y];
      }
    expect(shore).not.toBeNull();
    const s = sim(5, 3, shore![0] + 0.5, shore![1] + 4.5, 5);
    let rise = -1;
    let hurtAt = -1;
    let ghostBefore = false;
    for (let t = 0; t < 60 * 12; t++) {
      // Секунду стоим поодаль, потом подходим к кромке.
      if (t === 60) {
        s.hero.x = shore![0] + 0.5;
        s.hero.y = shore![1] + 0.5;
      }
      stepSim(s, DT, NO_INPUT);
      const g = s.mobs.find((m) => m.kind === 'f3_grasp');
      if (g && g.mode === 'lurk' && g.data.ghost) ghostBefore = true;
      if (g && g.mode === 'rise' && rise < 0) rise = s.time;
      if (s.events.some((e) => e.t === 'hurt') && hurtAt < 0) hurtAt = s.time;
      if (hurtAt > 0) break;
    }
    expect(ghostBefore).toBe(true);
    expect(rise).toBeGreaterThan(0);
    expect(hurtAt - rise).toBeGreaterThanOrEqual(0.5);
    // Хват тянет к воде и вяжет.
    expect(s.hero.status.slow).toBeTruthy();
  });

  it('краб держит удар панцирем спереди, со спины — ранится', () => {
    const lift = liftOf(world, 'f3rim')!;
    const hit = (behind: boolean) => {
      const s = sim(5, 3, lift.x + 0.5, lift.y - 3.5, 9);
      for (let i = 0; i < 70; i++) stepSim(s, DT, NO_INPUT);
      const c = spawnMob(s, 'f3_crab', s.hero.x + 1.1, s.hero.y, { mode: 'chase' });
      c.cd = 99;
      // Панцирь смотрит на героя (влево) или от него (вправо).
      c.data.sh = behind ? 0 : Math.PI;
      const hp = c.hp;
      for (let i = 0; i < 12; i++) {
        c.data.sh = behind ? 0 : Math.PI;
        stepSim(s, DT, { ...NO_INPUT, attack: i === 0, aim: { x: 1, y: 0 } });
      }
      return hp - c.hp;
    };
    expect(hit(false)).toBe(0);
    expect(hit(true)).toBeGreaterThan(0);
  });

  it('шар-копьё проносится сквозь героя и застревает в стене', () => {
    const lift = liftOf(world, 'f3rim')!;
    const s = sim(5, 3, lift.x + 0.5, lift.y - 1.5, 4);
    for (let i = 0; i < 70; i++) stepSim(s, DT, NO_INPUT);
    const b = spawnMob(s, 'f3_spear', s.hero.x - 5, s.hero.y, { mode: 'chase' });
    b.cd = 0;
    let hitAt = -1;
    let rolledAfter = false;
    let stuck = false;
    for (let t = 0; t < 60 * 6; t++) {
      stepSim(s, DT, NO_INPUT);
      if (s.events.some((e) => e.t === 'hurt') && hitAt < 0) hitAt = s.time;
      if (hitAt > 0 && s.time - hitAt > 0.05 && b.mode === 'roll') rolledAfter = true;
      if (b.mode === 'dizzy' && b.data.stuck) stuck = true;
      if (stuck) break;
    }
    expect(hitAt).toBeGreaterThan(0);
    expect(rolledAfter).toBe(true);
    expect(stuck).toBe(true);
  });
});

describe('этаж 3: проходимость', () => {
  it('на Нефелиновом +3 бот доходит от лифта до логова и почти не умирает', () => {
    const lift = liftOf(world, 'f3rim')!;
    const plaque = world.objs.find((o) => o.kind === 'plaque')!;
    const goal = field(plaque.x, plaque.y);
    let deaths = 0;
    let arrived = 0;
    let kills = 0;
    for (const seed of [1, 2, 3, 4]) {
      const s = sim(5, 3, lift.x + 0.5, lift.y + 0.5, seed);
      s.sack.meat.f3_fish = 10;
      const st = botState(seed);
      for (let t = 0; t < 300 * 60; t++) {
        stepSim(s, DT, bot(s, goal, st));
        for (const e of s.events) if (e.t === 'kill') kills++;
        if (s.hero.mode === 'dead') break;
        if (Math.hypot(plaque.x + 0.5 - s.hero.x, plaque.y + 0.5 - s.hero.y) < 1.5) {
          arrived++;
          break;
        }
      }
      if (s.hero.mode === 'dead') deaths++;
    }
    if (process.env.F3PACE) console.log('проход: дошёл', arrived, 'умер', deaths, 'убил', kills);
    expect(deaths).toBeLessThanOrEqual(1);
    expect(arrived).toBeGreaterThanOrEqual(3);
    expect(kills / 4).toBeGreaterThan(5);
  });
});

describe('этаж 3: Алая пасть', () => {
  it('на Лопаритовом +3 бот побеждает за 1–5 минут и не всегда умирает', () => {
    const times: number[] = [];
    for (const seed of [11, 12, 13, 14]) {
      const { won, splashes, minWarn } = fight(6, 3, seed);
      if (won > 0) times.push(won);
      // Прыжок из воды виден заранее: круг приземления горит весь полёт.
      expect(splashes).toBeGreaterThan(0);
      expect(minWarn).toBeGreaterThanOrEqual(0.65);
    }
    if (process.env.F3PACE) console.log('Алая пасть, с:', times);
    expect(times.length).toBeGreaterThanOrEqual(2);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avg).toBeGreaterThan(60);
    expect(avg).toBeLessThan(300);
  });

  it('прилив заливает отмели, но не под героем; победа — вода уходит', () => {
    const s = sim(6, 3, boss.x + 0.5, boss.y + 3.5, 21);
    const st = botState(21);
    let flooded = 0;
    for (let t = 0; t < 60 * 200; t++) {
      stepSim(s, DT, bot(s, null, st));
      if (s.hero.mode === 'dead') break;
      const under = s.tiles[Math.floor(s.hero.y) * W + Math.floor(s.hero.x)];
      expect(under).not.toBe(Tile.Deep);
      if (t % 30 === 0) {
        let n = 0;
        for (let i = 0; i < s.tiles.length; i++)
          if (world.mark[i] === F3_MARK.tide && s.tiles[i] === Tile.Deep) n++;
        flooded = Math.max(flooded, n);
      }
      if (s.boss!.state === 'won') break;
    }
    expect(flooded).toBeGreaterThan(20);
    if (s.boss!.state === 'won') {
      stepSim(s, DT, NO_INPUT);
      for (let i = 0; i < s.tiles.length; i++)
        if (world.mark[i] === F3_MARK.tide) expect(s.tiles[i]).not.toBe(Tile.Deep);
    }
  });

  it('после победы из арены выходят через ворота, ворота не захлопываются на герое', () => {
    const probe = sim(6, 3, 1, 1, 1);
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
    const N = 60;
    for (let k = 0; k < N; k++) {
      const { gate, goal } = targets[k % targets.length];
      const from = cellsIn[(k * 37) % cellsIn.length];
      const s = sim(6, 3, (from % W) + 0.5, Math.floor(from / W) + 0.5, 100 + k);
      s.boss!.state = 'won';
      s.mobs = [];
      const f = field(goal % W, Math.floor(goal / W));
      for (let t = 0; t < 30 * 60; t++) {
        const h = s.hero;
        const i = Math.floor(h.y) * W + Math.floor(h.x);
        let mx = 0;
        let my = 0;
        let bestD = f[i];
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const j = i + dy * W + dx;
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
      const h = s.hero;
      const atGoal = Math.hypot((goal % W) + 0.5 - h.x, Math.floor(goal / W) + 0.5 - h.y) < 0.8;
      if (!atGoal && process.env.F3PACE)
        console.log(
          'не вышел',
          from % W,
          Math.floor(from / W),
          '→',
          h.x.toFixed(1),
          h.y.toFixed(1),
        );
      if (atGoal) {
        exits += 1;
        expect(s.tiles[gate]).toBe(Tile.Gate);
      }
    }
    expect(exits).toBe(N);
  });

  it('данные этажа: босс, шахты с блоками Угля и Меди', () => {
    expect(F3.boss.parts).toEqual(['f3_maw']);
    for (const m of F3.mines) expect(m.ores).toEqual([4, 5]);
    expect(F3.mats.find((m) => m.id === 'f3_fang')?.stack).toBe(1);
  });
});

// Замер для подгонки: `F3PACE=1 npx vitest run src/lib/dungeon-floors/f3.test.ts -t замер`
// (T, P — ступень и заточка, V=1 — ход боя по режимам).
describe.runIf(!!process.env.F3PACE)('этаж 3: замер', () => {
  it('замер боя с Алой пастью', () => {
    const tier = Number(process.env.T ?? 6);
    const plus = Number(process.env.P ?? 3);
    const out: string[] = [];
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const s = sim(tier, plus, boss.x + 0.5, boss.y + 3.5, seed);
      s.sack.meat.f3_fish = 8;
      const st = botState(seed);
      let last = '';
      let hurts = 0;
      let dmg = 0;
      let won = -1;
      const arts: Record<string, number> = {};
      const from: Record<string, number> = {};
      for (let t = 0; t < 300 * 60; t++) {
        const hp0 = s.hero.hp;
        stepSim(s, DT, bot(s, null, st));
        for (const e of s.events) {
          if (e.t === 'hurt') {
            hurts++;
            dmg += e.dmg;
            const m = s.mobs.find((x) => x.kind === 'f3_maw');
            const k = m ? m.mode : '?';
            from[k] = (from[k] ?? 0) + Math.round(hp0 - s.hero.hp);
          }
          if (e.t === 'boss' && e.what === 'dead') won = s.time;
        }
        for (const k of s.strikes)
          if (k.t === 0) arts[k.art ?? '?'] = (arts[k.art ?? '?'] ?? 0) + 1;
        const m = s.mobs.find((x) => x.kind === 'f3_maw');
        if (m && process.env.V && m.mode !== last) {
          last = m.mode;
          console.log(
            seed,
            s.time.toFixed(1),
            m.mode,
            `пасть ${((100 * m.hp) / m.maxHp).toFixed(0)}%`,
            `герой ${((100 * s.hero.hp) / s.stats.maxHp).toFixed(0)}%`,
            `фаза ${s.boss?.phase}`,
          );
        }
        if (won > 0 || s.hero.mode === 'dead') break;
      }
      const m = s.mobs.find((x) => x.kind === 'f3_maw');
      out.push(
        `зерно ${seed}: ${won > 0 ? `победа ${won.toFixed(0)} с` : `смерть ${s.time.toFixed(0)} с`}, пасть ${m ? ((100 * m.hp) / m.maxHp).toFixed(0) : 0}%, ударов ${hurts}, урон ${dmg}/${s.stats.maxHp}, удары ${JSON.stringify(arts)}, урон по режимам ${JSON.stringify(from)}`,
      );
    }
    console.log(out.join('\n'));
  });
});
