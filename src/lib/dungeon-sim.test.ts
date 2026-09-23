import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from './dungeon';
import type { DungeonState, Gear } from './dungeon';
import { bandOf, buildWorld, liftOf, Tile, walkableTile } from './dungeon-world';
import {
  createSim,
  NO_INPUT,
  packAtMine,
  snapshot,
  spawnMob,
  stepSim,
  SWORD,
  takeDelta,
  usableNear,
  useObject,
} from './dungeon-sim';
import type { Sim, SimEvent, SimInput } from './dungeon-sim';

const world = buildWorld();
const DT = 1 / 60;

function dungeon(tier: number, plus: number, extra: Partial<DungeonState> = {}): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, ...extra };
}

function sim(
  tier: number,
  plus: number,
  x: number,
  y: number,
  seed = 7,
  extra: Partial<DungeonState> = {},
) {
  const d = dungeon(tier, plus, extra);
  return createSim({
    world,
    dungeon: d,
    stats: heroOf(d),
    econ: 1000,
    x,
    y,
    seed,
    now: () => 1e12,
  });
}

/** Поле расстояний до цели — бот идёт по нему. */
function field(tx: number, ty: number): Int32Array {
  const f = new Int32Array(world.w * world.h).fill(-1);
  const q = [ty * world.w + tx];
  f[q[0]] = 0;
  while (q.length) {
    const i = q.shift()!;
    const x = i % world.w;
    const y = Math.floor(i / world.w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const j = (y + dy) * world.w + x + dx;
      const t = world.tiles[j];
      if (f[j] >= 0 || !(walkableTile(t) || t === Tile.Gate)) continue;
      f[j] = f[i] + 1;
      q.push(j);
    }
  }
  return f;
}

/**
 * Бот: живой игрок средней руки. Видит замах — уворачивается, но с
 * задержкой реакции 0,3 с; ест, когда здоровья меньше 40%; дерётся с
 * ближайшим, остальное время идёт к цели.
 */
function bot(s: Sim, goal: Int32Array | null, st: { lastAtk: number; noEat?: boolean }): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  const REACT = 0.3;
  for (const m of s.mobs) {
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const danger =
      (m.mode === 'windup' && m.t > REACT && d < MOBS[m.kind].reach + m.r + 0.9) ||
      (m.mode === 'rollAim' && m.t > 0.5 && d < 5) ||
      (m.mode === 'whipAim' && m.t > 0.4 && d < 2.8);
    if (danger && h.dashCd <= 0) {
      const away = Math.atan2(h.y - m.y, h.x - m.x) + 0.9;
      inp.mx = Math.cos(away);
      inp.my = Math.sin(away);
      inp.dash = true;
      return inp;
    }
  }
  for (const b of s.bombs) {
    const d = Math.hypot(b.x - h.x, b.y - h.y);
    if (d < b.r + 0.6) {
      const away = Math.atan2(h.y - b.y, h.x - b.x);
      inp.mx = Math.cos(away);
      inp.my = Math.sin(away);
      if (b.fuse < 0.6 && h.dashCd <= 0) inp.dash = true;
      return inp;
    }
  }
  const meat = (s.sack.meat.meat ?? 0) + (s.sack.meat.fatmeat ?? 0);
  if (!st.noEat && h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free') inp.eat = true;
  let near = null as Sim['mobs'][number] | null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge' || m.mode === 'escape') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near && nd < 7) {
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    if (nd > SWORD.reach * 0.8) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
    }
    if (nd < SWORD.reach + near.r && s.time - st.lastAtk > 0.14) {
      inp.attack = true;
      st.lastAtk = s.time;
    }
    return inp;
  }
  // Ящик или бочка на пути — разбить, как сделал бы живой игрок.
  for (const p of s.props) {
    if (!p.alive || !['crate', 'barrel', 'nest', 'cartnest'].includes(p.kind)) continue;
    if (Math.hypot(p.x - h.x, p.y - h.y) < SWORD.reach + p.r - 0.1 && s.time - st.lastAtk > 0.3) {
      inp.attack = true;
      inp.aim = { x: p.x - h.x, y: p.y - h.y };
      st.lastAtk = s.time;
      return inp;
    }
  }
  if (goal) {
    const cx = Math.floor(h.x);
    const cy = Math.floor(h.y);
    let best = goal[cy * world.w + cx];
    let bx = 0;
    let by = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const v = goal[(cy + dy) * world.w + cx + dx];
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

function run(
  s: Sim,
  sec: number,
  goal: Int32Array | null,
  onEvent?: (e: SimEvent) => void,
  noEat = false,
) {
  const st = { lastAtk: -9, noEat };
  const all: SimEvent[] = [];
  for (let t = 0; t < sec * 60; t++) {
    stepSim(s, DT, bot(s, goal, st));
    for (const e of s.events) {
      all.push(e);
      onEvent?.(e);
    }
    if (s.hero.mode === 'dead') break;
  }
  return all;
}

describe('подземелье: бой', () => {
  it('герой не проходит сквозь стену', () => {
    const lift = liftOf(world, 'mouth')!;
    const s = sim(1, 0, lift.x + 0.5, lift.y + 0.5);
    for (let i = 0; i < 240; i++) stepSim(s, DT, { ...NO_INPUT, mx: 1, my: 0 });
    // Справа от клети в её ряду — стена двора.
    let wall = lift.x;
    while (walkableTile(world.tiles[lift.y * world.w + wall + 1])) wall++;
    wall += 1;
    expect(s.hero.x).toBeLessThan(wall);
    expect(s.hero.x).toBeGreaterThan(wall - 1);
  });

  it('пасюк Устья падает с двух ударов первого комплекта', () => {
    const h = heroOf(dungeon(1, 0));
    expect(h.dmg * 0.9 * 2).toBeGreaterThanOrEqual(MOBS.rat.hp);
    expect(h.dmg * 1.1).toBeLessThan(MOBS.rat.hp);
  });

  it('убитая крыса роняет мясо, оно летит в сидор', () => {
    const lift = liftOf(world, 'mouth')!;
    const s = sim(1, 5, lift.x + 0.5, lift.y - 8, 3);
    for (let i = 0; i < 6; i++)
      spawnMob(s, 'rat', s.hero.x + 1.2, s.hero.y - 0.3 + i * 0.1, { mode: 'chase' });
    const ev = run(s, 12, null);
    expect(ev.filter((e) => e.t === 'kill').length).toBeGreaterThanOrEqual(6);
    expect((s.sack.meat.meat ?? 0) > 0 || (s.sack.mats.skin ?? 0) > 0).toBe(true);
    expect(takeDelta(s).kills.rat).toBeGreaterThanOrEqual(6);
  });

  it('вагонетка, отправленная ударом, давит крыс на рельсах', () => {
    const cart = s0Cart();
    const s = sim(1, 0, cart.x + 0.5, cart.y + 1.5, 5);
    const rat = spawnMob(s, 'rat', cart.x + 0.5, cart.y - 3.5, { mode: 'sleep' });
    // Удар вверх по вагонетке.
    stepSim(s, DT, { ...NO_INPUT, attack: true, aim: { x: 0, y: -1 } });
    for (let i = 0; i < 90; i++) stepSim(s, DT, NO_INPUT);
    expect(rat.hp).toBeLessThanOrEqual(0);
  });

  it('бочка с порохом рвётся и сносит крыс вокруг', () => {
    const p = world.objs.find((o) => o.kind === 'powder' && o.area === 'mouth')!;
    const s = sim(1, 0, p.x + 0.5, p.y + 1.6, 9);
    // Первую секунду у героя неуязвимость появления — пережидаем.
    for (let i = 0; i < 70; i++) stepSim(s, DT, NO_INPUT);
    const rats = [0, 1, 2].map((i) =>
      spawnMob(s, 'rat', p.x + 0.5 + (i - 1) * 0.9, p.y - 0.6, { mode: 'sleep' }),
    );
    stepSim(s, DT, { ...NO_INPUT, attack: true, aim: { x: 0, y: -1 } });
    for (let i = 0; i < 60; i++) stepSim(s, DT, NO_INPUT);
    expect(rats.every((r) => r.hp <= 0)).toBe(true);
    // И героя задело: стоял рядом.
    expect(s.hero.hp).toBeLessThan(s.stats.maxHp);
  });

  it('рывок под укус — уклон в последний миг: замедление и крит', () => {
    // В главном штреке, подальше от клети: у клети крысы не кусают.
    const lift = liftOf(world, 'mouth')!;
    const s = sim(1, 0, lift.x + 0.5, lift.y - 22, 11);
    const rat = spawnMob(s, 'rat', s.hero.x + 0.7, s.hero.y, { mode: 'chase' });
    rat.cd = 0;
    let dodged = false;
    for (let i = 0; i < 120 && !dodged; i++) {
      const left = rat.mode === 'windup' ? MOBS.rat.windup - rat.t : 1;
      const inp = { ...NO_INPUT, dash: rat.mode === 'windup' && left < 0.12, mx: -1 };
      stepSim(s, DT, inp);
      if (s.events.some((e) => e.t === 'dodge')) dodged = true;
    }
    expect(dodged).toBe(true);
    expect(s.hero.sure).toBe(true);
    expect(s.slowmo).toBeGreaterThan(0);
    expect(s.hero.hp).toBe(s.stats.maxHp);
  });

  it('Устье в первом комплекте проходимо: бот ходит 4 минуты и почти не умирает', () => {
    const lift = liftOf(world, 'mouth')!;
    const top = bandOf(world, 'mouth')!;
    let deaths = 0;
    let kills = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = sim(1, 2, lift.x + 0.5, lift.y + 0.5, seed);
      // Туда и обратно: к верху Устья (верхний штрек) и к клети.
      const up = field(lift.x, top.top + 2);
      const down = field(lift.x, lift.y);
      run(s, 120, up, (e) => e.t === 'kill' && (kills += 1));
      if (s.hero.mode !== 'dead') run(s, 120, down, (e) => e.t === 'kill' && (kills += 1));
      if (s.hero.mode === 'dead') deaths += 1;
    }
    expect(deaths).toBeLessThanOrEqual(2);
    expect(kills / 6).toBeGreaterThan(25);
  });

  it('Откатка просит следующий комплект: на +0 без еды опасно, к +5 — спокойно', () => {
    const b = bandOf(world, 'haul')!;
    const hl = liftOf(world, 'haul')!;
    // От стыка с Устьем — к верхней клети и обратно.
    const start = { x: hl.x + 0.5, y: b.top + b.h - 3 };
    const up = field(hl.x, hl.y);
    const down = field(hl.x, b.top + b.h - 3);
    const deaths = (plus: number) => {
      let n = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const s = sim(2, plus, start.x, start.y, seed);
        run(s, 150, up, undefined, true);
        if (s.hero.mode !== 'dead') run(s, 150, down, undefined, true);
        if (s.hero.mode === 'dead') n += 1;
      }
      return n;
    };
    expect(deaths(0)).toBeGreaterThanOrEqual(2);
    expect(deaths(5)).toBe(0);
  });

  it('король на Забойном +3 падает за одну-четыре минуты', () => {
    const boss = world.objs.find((o) => o.kind === 'boss')!;
    const results: number[] = [];
    for (const seed of [21, 22, 23, 24]) {
      const s = sim(2, 3, boss.x + 4.5, boss.y + 0.5, seed);
      // Бой короля короче минуты не бывает: у него 1750 здоровья на уровне Откатки.
      let won = -1;
      const st = { lastAtk: -9 };
      for (let t = 0; t < 300 * 60; t++) {
        stepSim(s, DT, bot(s, null, st));
        if (s.events.some((e) => e.t === 'boss' && e.what === 'dead')) {
          won = s.time;
          break;
        }
        if (s.hero.mode === 'dead') break;
      }
      results.push(won);
    }
    const wins = results.filter((t) => t > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    for (const t of wins) {
      expect(t).toBeGreaterThan(45);
      expect(t).toBeLessThan(240);
    }
  });

  it('король на Лагерном без заточки — смерть чаще победы', () => {
    const boss = world.objs.find((o) => o.kind === 'boss')!;
    let wins = 0;
    for (const seed of [31, 32, 33]) {
      const s = sim(1, 0, boss.x + 4.5, boss.y + 0.5, seed);
      const st = { lastAtk: -9 };
      for (let t = 0; t < 240 * 60; t++) {
        stepSim(s, DT, bot(s, null, st));
        if (s.events.some((e) => e.t === 'boss' && e.what === 'dead')) {
          wins += 1;
          break;
        }
        if (s.hero.mode === 'dead') break;
      }
    }
    expect(wins).toBeLessThanOrEqual(1);
  });

  it('фонарь, решётка и тайник — через кнопку действия', () => {
    const unlit = world.objs.find((o) => o.kind === 'unlit')!;
    const s = sim(1, 0, unlit.x + 0.5, unlit.y + 1.3, 1);
    const u = usableNear(s);
    expect(u?.kind).toBe('light');
    expect(useObject(s, u!)).toBe(true);
    expect(takeDelta(s).lamps).toEqual([unlit.id]);
    // Решётка открывается только изнутри ходка.
    const grate = world.objs.find((o) => o.kind === 'grate')!;
    const out = sim(1, 0, grate.x - 0.6, grate.y + 0.5, 1);
    expect(usableNear(out)?.kind).not.toBe('grate');
    const inside = sim(1, 0, grate.x + 1.5, grate.y + 0.5, 1);
    const g = usableNear(inside)!;
    expect(g.kind).toBe('grate');
    useObject(inside, g);
    expect(inside.tiles[grate.y * world.w + grate.x]).toBe(Tile.Floor);
  });

  it('у входа в шахту после копки собирается стая', () => {
    const mine = world.objs.find((o) => o.kind === 'mine' && o.area === 'mouth')!;
    const s = sim(1, 0, mine.x + 0.5, mine.y + 1.5, 4);
    packAtMine(s, mine, 3);
    expect(s.mobs.length).toBeGreaterThanOrEqual(6);
  });

  it('снимок вылазки — в местных координатах района', () => {
    const lift = liftOf(world, 'haul')!;
    const s = sim(1, 0, lift.x + 0.5, lift.y + 0.5, 1);
    const snap = snapshot(s);
    expect(snap.area).toBe('haul');
    expect(snap.ly).toBeCloseTo(lift.ly + 0.5);
  });
});

function s0Cart() {
  // Вагонетка в рельсовом коридоре Устья: рельсы вдоль, есть куда катиться.
  return world.objs.find((o) => o.kind === 'cart' && o.area === 'mouth' && o.axis === 'v')!;
}
