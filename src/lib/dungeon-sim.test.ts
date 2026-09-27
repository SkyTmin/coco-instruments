// Бой подземелья и баланс первого этажа «Крысиные норы» (v2.81). Движок
// общий, карты и монстры — этажа 1: Вход в шахты (первый комплект) и
// Прогрызенные штреки (второй). Короля и механики этажа (капканы,
// растяжки, Зал черепов, броня латника, чары шамана) держит
// `dungeon-floors/f1.test.ts`.

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
  strikeHits,
  SWORD,
  takeDelta,
  usableNear,
  useObject,
} from './dungeon-sim';
import type { Sim, SimEvent, SimInput } from './dungeon-sim';
import { f1State } from './dungeon-floors/f1-brains';

const world = buildWorld(1);
const DT = 1 / 60;
const DIAG = !!process.env.DIAG;

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
    x,
    y,
    seed,
    now: () => 1e12,
  });
}

/** Клетки с капканами: живой игрок их видит и обходит. */
const TRAPS = new Set(
  world.objs.filter((o) => o.ref === 'f1_trap').map((o) => o.y * world.w + o.x),
);

/** Поле расстояний до цели — бот идёт по нему (капканы обходит). */
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
      if (f[j] >= 0 || !(walkableTile(t) || t === Tile.Gate) || TRAPS.has(j)) continue;
      f[j] = f[i] + 1;
      q.push(j);
    }
  }
  return f;
}

const REACT = 0.3;

/** Куда уйти от угрозы: прочь от середины (или вбок от линии). */
function away(
  hx: number,
  hy: number,
  cx: number,
  cy: number,
  line?: number,
): { x: number; y: number } {
  if (line !== undefined) {
    const nx = -Math.sin(line);
    const ny = Math.cos(line);
    const side = (hx - cx) * nx + (hy - cy) * ny >= 0 ? 1 : -1;
    return { x: nx * side, y: ny * side };
  }
  const a = Math.atan2(hy - cy, hx - cx) + 0.5;
  return { x: Math.cos(a), y: Math.sin(a) };
}

/**
 * Бот: живой игрок средней руки. Видит метки на полу — замах, линию,
 * конус, круг, место падения камня — и уходит из них с задержкой реакции
 * 0,3 с (рывком, если рывок готов). Капканы обходит, растяжки
 * перепрыгивает рывком, из капкана вырывается рывком. Ест, когда здоровья
 * меньше 40%; дерётся с ближайшим, латника бьёт, только когда тот открыт;
 * остальное время идёт к цели.
 */
function bot(s: Sim, goal: Int32Array | null, st: { lastAtk: number; noEat?: boolean }): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  const flee = (d: { x: number; y: number }, now: boolean) => {
    inp.mx = d.x;
    inp.my = d.y;
    if (now && h.dashCd <= 0) inp.dash = true;
    return inp;
  };
  const f1 = f1State(s);
  if (f1?.held) return flee({ x: -Math.sin(h.face), y: Math.cos(h.face) }, true);
  for (const m of s.mobs) {
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const def = MOBS[m.kind];
    if (m.mode === 'windup' && m.t > REACT && d < def.reach + m.r + 0.9)
      return flee(away(h.x, h.y, m.x, m.y), true);
    const t = m.tele;
    if (t && t.k > 0.45) {
      const zone = {
        shape: t.shape,
        x: t.x ?? m.x,
        y: t.y ?? m.y,
        r: t.r,
        w: t.w,
        ang: t.ang,
        arc: t.arc,
        warn: 1,
        dmg: 0,
      };
      if (strikeHits(zone, h.x, h.y, h.r + 0.25))
        return flee(
          away(h.x, h.y, zone.x, zone.y, t.shape === 'line' ? t.ang : undefined),
          t.k > 0.6,
        );
    }
  }
  for (const z of s.strikes) {
    if (z.t < REACT * 0.6 || !strikeHits(z, h.x, h.y, h.r + 0.3)) continue;
    // Внутри кольца волны — безопасно: стоим.
    if (z.shape === 'ring' && Math.hypot(h.x - z.x, h.y - z.y) < z.r - (z.w ?? 0.6) - 0.3) continue;
    return flee(
      away(h.x, h.y, z.x, z.y, z.shape === 'line' ? z.ang : undefined),
      z.warn - z.t < 0.3,
    );
  }
  for (const sh of s.shots) {
    if (!sh.lob || sh.age < REACT * 0.5) continue;
    if (Math.hypot(h.x - sh.lob.x1, h.y - sh.lob.y1) < sh.r + h.r + 0.35)
      return flee(away(h.x, h.y, sh.lob.x1, sh.lob.y1), sh.lob.T - sh.age < 0.3);
  }
  for (const b of s.bombs) {
    const d = Math.hypot(b.x - h.x, b.y - h.y);
    if (d < b.r + 0.6) return flee(away(h.x, h.y, b.x, b.y), b.fuse < 0.6);
  }
  const meat = (s.sack.meat.meat ?? 0) + (s.sack.meat.fatmeat ?? 0);
  if (!st.noEat && h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free') inp.eat = true;
  let near = null as Sim['mobs'][number] | null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge' || m.mode === 'escape') continue;
    if ((m.data.ghost ?? 0) > 0) continue;
    let d = Math.hypot(m.x - h.x, m.y - h.y);
    // Латник со щитом — потом: сперва те, кого можно ранить.
    if (m.kind === 'f1_guard' && ['chase', 'windup', 'bashAim', 'bash'].includes(m.mode)) d += 3;
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near && nd < 7) {
    const real = Math.hypot(near.x - h.x, near.y - h.y);
    let a = Math.atan2(near.y - h.y, near.x - h.x);
    // К латнику со щитом — заходить сбоку.
    if (near.kind === 'f1_guard' && nd !== real) a += 0.9;
    if (real > SWORD.reach * 0.8) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
    }
    if (real < SWORD.reach + near.r && s.time - st.lastAtk > 0.14) {
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
    // Растяжка впереди — перепрыгнуть рывком (или подождать рывка).
    const ahead = Math.floor(h.y + inp.my * 0.8) * world.w + Math.floor(h.x + inp.mx * 0.8);
    if (f1?.wires.some((w) => w.live && w.cells.has(ahead))) {
      if (h.dashCd <= 0) inp.dash = true;
      else {
        inp.mx = 0;
        inp.my = 0;
      }
    }
  }
  return inp;
}

/** Кто бил героя — для разбора прогонов (`DIAG=1`). */
function blame(s: Sim, e: SimEvent): string {
  if (e.t !== 'hurt') return '';
  let best = 'удар по площади';
  let bd = 3;
  for (const m of s.mobs) {
    const d = Math.hypot(m.x - e.x, m.y - e.y);
    if (d < bd) {
      bd = d;
      best = m.kind;
    }
  }
  if (s.shots.length && bd > 1.5) best = 'камень';
  return best;
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
  const hits: Record<string, number> = {};
  for (let t = 0; t < sec * 60; t++) {
    stepSim(s, DT, bot(s, goal, st));
    for (const e of s.events) {
      all.push(e);
      onEvent?.(e);
      if (DIAG && e.t === 'hurt') {
        const who = blame(s, e);
        hits[who] = (hits[who] ?? 0) + e.dmg;
      }
    }
    if (s.hero.mode === 'dead') break;
  }
  if (DIAG) console.log('урон по герою', JSON.stringify(hits), 'жив:', s.hero.mode !== 'dead');
  return all;
}

describe('подземелье: бой', () => {
  it('герой не проходит сквозь стену', () => {
    const lift = liftOf(world, 'mouth')!;
    const s = sim(1, 0, lift.x + 0.5, lift.y + 0.5);
    for (let i = 0; i < 600; i++) stepSim(s, DT, { ...NO_INPUT, mx: -1, my: 0 });
    // Слева от лифта в его ряду — стена двора.
    let wall = lift.x;
    while (walkableTile(world.tiles[lift.y * world.w + wall - 1])) wall--;
    expect(s.hero.x).toBeGreaterThan(wall);
    expect(s.hero.x).toBeLessThan(wall + 1);
  });

  it('серая крыса у входа падает с двух ударов первого комплекта', () => {
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
    // В главном штреке, подальше от лифта: у лифта крысы не кусают.
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

  it('Вход в шахты в первом комплекте проходим: бот ходит 4 минуты и почти не умирает', () => {
    const lift = liftOf(world, 'mouth')!;
    const top = bandOf(world, 'mouth')!;
    let deaths = 0;
    let kills = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = sim(1, 2, lift.x + 0.5, lift.y + 0.5, seed);
      // Туда и обратно: к верху Входа (верхний штрек) и к лифту.
      const up = field(32, top.top + 2);
      const down = field(lift.x, lift.y);
      run(s, 120, up, (e) => e.t === 'kill' && (kills += 1));
      if (s.hero.mode !== 'dead') run(s, 120, down, (e) => e.t === 'kill' && (kills += 1));
      if (s.hero.mode === 'dead') deaths += 1;
    }
    if (DIAG) console.log('Вход: смертей', deaths, 'убийств в среднем', kills / 6);
    expect(deaths).toBeLessThanOrEqual(2);
    expect(kills / 6).toBeGreaterThan(25);
  });

  it('Штреки просят следующий комплект: на Т2+0 без еды опасно, к +5 — спокойно', () => {
    const b = bandOf(world, 'haul')!;
    const hl = liftOf(world, 'haul')!;
    // От стыка со Входом — к верхнему лифту и обратно.
    const start = { x: 32.5, y: b.top + b.h - 3 };
    const up = field(hl.x, hl.y);
    const down = field(32, b.top + b.h - 3);
    const deaths = (tier: number, plus: number) => {
      let n = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const s = sim(tier, plus, start.x, start.y, seed);
        run(s, 150, up, undefined, true);
        if (s.hero.mode !== 'dead') run(s, 150, down, undefined, true);
        if (s.hero.mode === 'dead') n += 1;
      }
      if (DIAG) console.log(`Штреки Т${tier}+${plus}: смертей`, n);
      return n;
    };
    expect(deaths(2, 0)).toBeGreaterThanOrEqual(2);
    expect(deaths(2, 5)).toBe(0);
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
  // Вагонетка в главном штреке Входа: рельсы вдоль, есть куда катиться.
  return world.objs.find((o) => o.kind === 'cart' && o.area === 'mouth' && o.axis === 'v')!;
}
