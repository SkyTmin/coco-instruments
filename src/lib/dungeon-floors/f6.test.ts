// Этаж 6 «Огненный разлом»: бот против Красного змея, выход с арены,
// корка голема, взрыв духа, нырок саламандры, гейзерное поле, мост за
// спиной, извержение, живая руда, червь в омуте.
//
// Бот — живой игрок средней руки: видит метки на полу и уходит из них
// (с задержкой реакции, изредка проглядывает), в последний миг — рывком,
// ест, когда здоровья меньше 40%, бьёт ближнего. Против змея не лезет под
// укус и хвост, стоит в просветах волны, бьёт открытого.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, liftOf, Tile, walkableTile } from '../dungeon-world';
import { BRAINS } from '../dungeon-ai';
import { API, createSim, NO_INPUT, spawnMob, stepSim, strikeHits, SWORD } from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import { BRIDGE, ERUPT, f6State, FIELD, GOLEM, isLava, SAL, WISP } from './f6-brains';
import { F6_GALLERY, F6_LAKES, F6_MARK, F6_NEST } from './f6';

const world = buildWorld(6);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F6LOG;

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 6 };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7, meat = 0): Sim {
  const d = dungeon(tier, plus);
  const s = createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
  if (meat) {
    s.sack.meat.f6_tail = meat;
    s.sack.meatBy[F6_GALLERY] = meat;
  }
  return s;
}

/** Поле расстояний до цели — бот идёт по нему. */
function field(tx: number, ty: number, s?: Sim): Int32Array {
  const tiles = s ? s.tiles : world.tiles;
  const f = new Int32Array(W * world.h).fill(-1);
  const q = [ty * W + tx];
  f[q[0]] = 0;
  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      const t = tiles[j];
      if (j < 0 || j >= f.length || f[j] >= 0 || !(walkableTile(t) || t === Tile.Gate)) continue;
      f[j] = f[i] + 1;
      q.push(j);
    }
  }
  return f;
}

const solid = (s: Sim, x: number, y: number) => {
  const t = s.tiles[Math.floor(y) * W + Math.floor(x)];
  return !walkableTile(t);
};
/** Внутри стены (не глубины): летуны и пловцы над лавой — не застряли. */
const inWall = (s: Sim, x: number, y: number) => {
  const t = s.tiles[Math.floor(y) * W + Math.floor(x)];
  return !walkableTile(t) && t !== Tile.Deep;
};

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

/** Куда уйти из метки: из круга — от центра, из полосы — поперёк, из конуса — вбок. */
function away(
  shape: string,
  x: number,
  y: number,
  ang: number | undefined,
  hx: number,
  hy: number,
): [number, number] {
  if (shape === 'line') {
    const a = ang ?? 0;
    const px = -Math.sin(a);
    const py = Math.cos(a);
    const side = (hx - x) * px + (hy - y) * py >= 0 ? 1 : -1;
    return [px * side, py * side];
  }
  if (shape === 'cone') {
    const side = Math.sin((ang ?? 0) - Math.atan2(hy - y, hx - x)) > 0 ? -1 : 1;
    const a = (ang ?? 0) + side * 1.9;
    return [Math.cos(a), Math.sin(a)];
  }
  const l = Math.hypot(hx - x, hy - y) || 1;
  return [(hx - x) / l, (hy - y) / l];
}

/**
 * Бот: метки ударов → метки ИИ (круги, линии) → замах вплотную → лужи под
 * ногами → еда → бой с ближним → путь к цели.
 */
function bot(s: Sim, goal: Int32Array | null, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  const go = (d: [number, number], dash: boolean) => {
    inp.mx = d[0];
    inp.my = d[1];
    if (dash && h.dashCd <= 0) inp.dash = true;
    return inp;
  };
  for (const z of s.strikes) {
    const left = z.warn - z.t;
    const [react, missed] = notice(st, `s${z.id}`);
    if (missed || z.t < react || !strikeHits(z, h.x, h.y, h.r + 0.25)) continue;
    return go(away(z.shape, z.x, z.y, z.ang, h.x, h.y), left < 0.22);
  }
  for (const m of s.mobs) {
    const t = m.tele;
    if (!t) continue;
    const [react, missed] = notice(st, `t${m.id}:${m.mode}:${Math.round((s.time - m.t) * 10)}`);
    if (missed || m.t < react) continue;
    const tx = t.x ?? m.x;
    const ty = t.y ?? m.y;
    const hit = strikeHits(
      { shape: t.shape, x: tx, y: ty, r: t.r, w: t.w, ang: t.ang, arc: t.arc, warn: 1, dmg: 0 },
      h.x,
      h.y,
      h.r + 0.3,
    );
    if (!hit) continue;
    return go(away(t.shape, tx, ty, t.ang, h.x, h.y), m.danger > 0);
  }
  for (const m of s.mobs) {
    if (m.mode !== 'f6_lunge' && m.mode !== 'f6_swoop') continue;
    const ux = Math.cos(m.dir);
    const uy = Math.sin(m.dir);
    const dx = h.x - m.x;
    const dy = h.y - m.y;
    const along = dx * ux + dy * uy;
    const across = -dx * uy + dy * ux;
    if (along > 0 && along < 4 && Math.abs(across) < m.r + h.r + 0.4) {
      const side = across >= 0 ? 1 : -1;
      return go([-uy * side, ux * side], true);
    }
  }
  for (const m of s.mobs) {
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (m.mode !== 'windup') continue;
    const [react, missed] = notice(st, `w${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (!missed && m.t > react && d < MOBS[m.kind].reach + m.r + 0.9 && h.dashCd <= 0) {
      const a = Math.atan2(h.y - m.y, h.x - m.x) + 0.9;
      return go([Math.cos(a), Math.sin(a)], true);
    }
  }
  for (const z of s.zones) {
    if (!z.dps || z.t < (z.warn ?? 0)) continue;
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d < z.r + h.r) return go([(h.x - z.x) / (d || 1), (h.y - z.y) / (d || 1)], false);
  }
  const meat = Object.values(s.sack.meat).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) inp.eat = true;

  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge' || (m.data.ghost ?? 0) > 0) continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near && near.kind === 'f6boss') {
    // Змея бьют, когда он открыт: оглушён, отдыхает, ползёт; под укус не лезут.
    const open = ['dizzy', 'recover', 'chase', 'roar', 'f6_summon'].includes(near.mode);
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    const reach = SWORD.reach + near.r;
    if (open) {
      if (nd > reach * 0.85) {
        inp.mx = Math.cos(a);
        inp.my = Math.sin(a);
      }
      if (nd < reach + 0.2 && s.time - st.lastAtk > 0.14) {
        inp.attack = true;
        st.lastAtk = s.time;
      }
      return inp;
    }
    return inp;
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
      if (v >= 0 && (best < 0 || v < best)) {
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

const bossObj = world.objs.find((o) => o.kind === 'boss')!;
const band = (area: string) => world.bands.find((b) => b.def.id === area)!;

/** Бой со змеем: время победы или −1. */
function fight(
  tier: number,
  plus: number,
  seed: number,
  meat = 4,
): { won: number; s: Sim; phase: number } {
  const s = sim(tier, plus, bossObj.x + 0.5, bossObj.y + 8.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.2, 0.42], miss: 0.1, seed };
  let won = -1;
  let phase = 0;
  for (let t = 0; t < 300 * 60; t++) {
    stepSim(s, DT, bot(s, null, st));
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'phase') phase = Math.max(phase, s.boss!.phase);
    }
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  if (LOG) {
    const m = s.mobs.find((x) => x.kind === 'f6boss');
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фаза ${phase}, змей ${m ? Math.round((100 * m.hp) / m.maxHp) : 0}%, здоровье ${Math.round(s.hero.hp)}/${s.stats.maxHp}`,
    );
  }
  return { won, s, phase };
}

describe('этаж 6: Красный змей', () => {
  it('на Сполохе +5 бот побеждает за 1–5 минут, но не всегда', () => {
    const res = [61, 62, 63, 64, 65, 66].map((seed) => fight(8, 5, seed));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(3);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(60);
      expect(r.won).toBeLessThan(300);
      expect(r.phase).toBe(3);
    }
  });

  it('на Сполохе без заточки и без еды — смерть чаще победы', () => {
    const res = [71, 72, 73].map((seed) => fight(8, 0, seed, 0).won);
    expect(res.filter((t) => t > 0).length).toBeLessThanOrEqual(1);
  });
});

/** Шаги мира без ввода; `each` — после каждого шага, true — остановиться. */
function run(s: Sim, secs: number, each?: (s: Sim) => boolean | void): boolean {
  for (let t = 0; t < secs * 60; t++) {
    stepSim(s, DT, NO_INPUT);
    if (each?.(s)) return true;
  }
  return false;
}
const tileAt = (s: Sim, x: number, y: number) => s.tiles[Math.floor(y) * W + Math.floor(x)];
const godMode = (s: Sim) => {
  s.hero.inv = 99;
  s.hero.hp = s.stats.maxHp;
};

describe('этаж 6: арена', () => {
  it('после победы из логова выходят: ворота не закрываются на герое', () => {
    const { won, s } = fight(8, 5, 61);
    expect(won).toBeGreaterThan(0);
    // Ворота — ряд G под ареной; цель — клетка за ними.
    const gate = world.objs.find((o) => o.kind === 'gate')!;
    const goal = field(gate.x, gate.y + 4, s);
    const st: BotState = { lastAtk: -9, react: [0.2, 0.3], miss: 0, seed: 5 };
    let out = false;
    for (let t = 0; t < 40 * 60 && !out; t++) {
      godMode(s);
      stepSim(s, DT, bot(s, goal, st));
      out = s.hero.y > gate.y + 2;
    }
    expect(out).toBe(true);
  });

  it('сброс боя возвращает арену: лава с краёв уходит, свет прежний', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 8.5, 5, 0);
    const lights = s.world.lights.length;
    const st: BotState = { lastAtk: -9, react: [0.2, 0.3], miss: 0, seed: 9 };
    // Бой идёт, змей на последней фазе — пусть арену заливает.
    let flooded = false;
    for (let t = 0; t < 90 * 60 && !flooded; t++) {
      godMode(s);
      const m = s.mobs.find((x) => x.kind === 'f6boss');
      if (m && m.hp > m.maxHp * 0.2) m.hp = m.maxHp * 0.2;
      stepSim(s, DT, bot(s, null, st));
      flooded = s.tiles.some((v, i) => v !== world.tiles[i] && v === Tile.Deep);
    }
    expect(flooded).toBe(true);
    expect(s.boss!.phase).toBe(3);
    // Герой пал — бой сброшен.
    s.hero.inv = 0;
    API.hurtHero(s, 1e9, s.hero.x, s.hero.y, 0, 'f6boss');
    run(s, 0.2);
    expect(s.boss!.state).toBe('idle');
    // Всё, что сменил сценарий змея, вернулось (ворота движок водит сам).
    const changed: string[] = [];
    for (let i = 0; i < s.tiles.length; i++)
      if (s.tiles[i] !== world.tiles[i] && world.tiles[i] !== Tile.Gate)
        changed.push(`${i % W},${Math.floor(i / W)}:${world.tiles[i]}→${s.tiles[i]}`);
    expect(changed).toEqual([]);
    expect(s.world.lights.length).toBe(lights);
  });
});

describe('этаж 6: монстры', () => {
  it('корка голема держит четыре удара, потом нутро берёт урон ×1,5', () => {
    const s = sim(8, 5, 30, 230);
    const m = spawnMob(s, 'f6_golem', 32, 230, { mode: 'chase' });
    const onHit = BRAINS.get('f6_golem')!.onHit!;
    const hit = { dmg: 10, crit: false, heavy: false, ang: 0 };
    const k = [0, 1, 2, 3].map(() => onHit(s, m, hit, API));
    expect(k).toEqual([GOLEM.armor, GOLEM.armor, GOLEM.armor, GOLEM.armor]);
    expect(m.data.plates).toBe(0);
    expect(onHit(s, m, hit, API)).toBe(GOLEM.molten);
    // Тяжёлый удар колет две плиты сразу.
    const g2 = spawnMob(s, 'f6_golem', 33, 231, { mode: 'chase' });
    onHit(s, g2, { ...hit, heavy: true }, API);
    expect(g2.data.plates).toBe(GOLEM.plates - 2);
  });

  it('голем без корки идёт к лаве и отмокает — плиты снова целы', () => {
    const s = sim(8, 5, 30, 150);
    const st = f6State(s);
    // Берег озера: клетка пола рядом с лавой.
    const lake = st.lakes.find((l) => l.area === F6_LAKES && l.cells.length > 30)!;
    let shore = -1;
    for (const i of lake.cells)
      for (const d of [W, -W, 1, -1]) {
        const j = i + d;
        if (shore < 0 && walkableTile(s.tiles[j])) shore = j;
      }
    const sx = (shore % W) + 0.5;
    const sy = Math.floor(shore / W) + 0.5;
    s.hero.x = sx;
    s.hero.y = sy - 7;
    const m = spawnMob(s, 'f6_golem', sx, sy, { mode: 'chase' });
    m.data.plates = 0;
    m.data.molten = s.time - 1;
    let bathed = false;
    const back = run(s, 12, (s2) => {
      godMode(s2);
      if (m.mode === 'f6_bathe' || m.mode === 'f6_harden') bathed = true;
      return m.data.plates === GOLEM.plates;
    });
    expect(bathed).toBe(true);
    expect(back).toBe(true);
  });

  it('дух взрывается, если не добить; добитый в раздутии гаснет без вреда', () => {
    const s = sim(8, 5, 30, 230);
    s.hero.inv = 0;
    const m = spawnMob(s, 'f6_wisp', 31, 230, { mode: 'chase' });
    const hp0 = s.hero.hp;
    let swelled = -1;
    let early = false;
    let blast = false;
    run(s, 6, (s2) => {
      if (m.mode === 'f6_swell' && swelled < 0) swelled = s2.time;
      // До взрыва герой цел: раздувание — предупреждение, а не урон.
      if (swelled > 0 && s2.time < swelled + WISP.swell - 0.02 && s2.hero.hp < hp0) early = true;
      if (s2.zones.some((z) => z.art === 'f6_blast')) blast = true;
      return blast;
    });
    expect(swelled).toBeGreaterThan(0);
    expect(early).toBe(false);
    expect(blast).toBe(true);
    expect(s.hero.hp).toBeLessThan(hp0);

    // Второй: раздулся — и тут его добили.
    const s2 = sim(8, 5, 30, 230);
    const w2 = spawnMob(s2, 'f6_wisp', 31, 230, { mode: 'chase' });
    run(s2, 4, () => w2.mode === 'f6_swell');
    expect(w2.mode).toBe('f6_swell');
    BRAINS.get('f6_wisp')!.onDeath!(s2, w2, 'f6_swell', API);
    API.setMode(w2, 'dying');
    w2.hp = 0;
    run(s2, 3);
    expect(s2.zones.some((z) => z.art === 'f6_blast')).toBe(false);
  });

  it('саламандра ныряет в лаву (недосягаема) и выныривает у героя с кругом-меткой', () => {
    const s = sim(8, 5, 30, 150);
    const st = f6State(s);
    const lake = st.lakes.find((l) => l.area === F6_LAKES && l.cells.length > 60)!;
    // Герой на берегу, саламандра в лаве в четырёх клетках от него.
    let shore = -1;
    for (const i of lake.cells)
      for (const d of [W, -W]) {
        const j = i + d;
        if (shore < 0 && walkableTile(s.tiles[j])) shore = j;
      }
    s.hero.x = (shore % W) + 0.5;
    s.hero.y = Math.floor(shore / W) + 0.5;
    const off = (i: number) =>
      Math.abs(Math.hypot((i % W) + 0.5 - s.hero.x, Math.floor(i / W) + 0.5 - s.hero.y) - 4);
    const cell = lake.cells.reduce((a, b) => (off(a) < off(b) ? a : b));
    const m = spawnMob(s, 'f6_salamander', (cell % W) + 0.5, Math.floor(cell / W) + 0.5, {
      mode: 'f6_swim',
    });
    m.data.ghost = 1;
    let ghostInLava = false;
    let tele = -1;
    let leapt = false;
    run(s, 12, () => {
      godMode(s);
      if (m.mode === 'f6_swim' && m.data.ghost === 1 && isLava(s, m.x, m.y)) ghostInLava = true;
      if (m.mode === 'f6_rise' && m.tele && m.tele.x !== undefined)
        tele = Math.hypot(m.tele.x - s.hero.x, (m.tele.y ?? 0) - s.hero.y);
      if (m.mode === 'f6_leap') leapt = true;
      return leapt;
    });
    expect(ghostInLava).toBe(true);
    expect(tele).toBeGreaterThanOrEqual(0);
    expect(tele).toBeLessThan(SAL.riseR + 0.6);
    expect(leapt).toBe(true);
  });

  it('живая руда лежит самородком, просыпается от шагов и роняет руду', () => {
    const s = sim(8, 5, 30, 230);
    const m = spawnMob(s, 'f6_ore', 34, 230, { mode: 'f6_hide' });
    m.data.v = 11;
    run(s, 1, (s2) => {
      godMode(s2);
    });
    expect(m.mode).toBe('f6_hide');
    s.hero.x = 33;
    run(s, 1, () => m.mode !== 'f6_hide');
    expect(m.mode).toBe('f6_wake');
    const before = s.drops.length;
    BRAINS.get('f6_ore')!.onDeath!(s, m, 'chase', API);
    const got = s.drops.slice(before).map((d) => String(d.kind));
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((id) => id === 'ore:11' || id === 'block:11')).toBe(true);
  });

  it('плевок червя: лужа загорается ровно тогда, когда он долетает', () => {
    const s = sim(8, 5, 30, 142);
    let warn = -1;
    let T = -1;
    run(s, 40, () => {
      godMode(s);
      const z = s.zones.find((q) => q.art === 'f6_lavapool' && q.t === 0);
      const shot = s.shots.find((q) => q.kind === 'f6_worm' && q.lob);
      if (!z || !shot) return false;
      warn = z.warn ?? 0;
      T = shot.lob!.T;
      return true;
    });
    expect(warn).toBeGreaterThan(0);
    expect(Math.abs(warn - T)).toBeLessThan(0.06);
  });

  it('никто не застревает в стенах', () => {
    const kinds = [
      'f6_salamander',
      'f6_wisp',
      'f6_golem',
      'f6_ashbat',
      'f6_beetle',
      'f6_ore',
      'f6_imp',
    ];
    const spots: [number, number][] = [
      [38, 300],
      [30, 226],
      [31.5, 180],
      [30, 142],
      [30, 70],
      [30, 42],
    ];
    for (const [x, y] of spots) {
      const s = sim(8, 5, x, y, 3);
      const st: BotState = { lastAtk: -9, react: [0.2, 0.4], miss: 0.1, seed: 3 };
      let k = 0;
      for (let dy = -5; dy <= 5 && k < kinds.length * 2; dy += 2)
        for (let dx = -6; dx <= 6 && k < kinds.length * 2; dx += 3) {
          if (solid(s, x + dx, y + dy) || tileAt(s, x + dx, y + dy) === Tile.Deep) continue;
          spawnMob(s, kinds[k % kinds.length], x + dx, y + dy, { mode: 'chase' });
          k++;
        }
      const stuck = new Map<number, number>();
      const trail = new Map<number, string[]>();
      for (let t = 0; t < 25 * 60; t++) {
        godMode(s);
        stepSim(s, DT, bot(s, null, st));
        for (const m of s.mobs) {
          if (m.mode === 'dying' || m.mode === 'emerge') continue;
          const n = inWall(s, m.x, m.y) ? (stuck.get(m.id) ?? 0) + 1 : 0;
          stuck.set(m.id, n);
          if (LOG) {
            const tr = trail.get(m.id) ?? [];
            tr.push(
              `${s.time.toFixed(2)} ${m.x.toFixed(2)},${m.y.toFixed(2)} ${m.mode} v=${m.vx.toFixed(1)},${m.vy.toFixed(1)}`,
            );
            if (tr.length > 90) tr.shift();
            trail.set(m.id, tr);
            if (n > 45) console.log(tr.join('\n'));
          }
          if (n > 45)
            throw new Error(`${m.kind} в стене у ${m.x.toFixed(1)},${m.y.toFixed(1)} (${m.mode})`);
        }
      }
    }
  });
});

describe('этаж 6: события', () => {
  it('гейзерный ряд бьёт только после метки', () => {
    const s = sim(8, 5, 38, 300);
    const f = f6State(s).field!;
    expect(f).not.toBeNull();
    const row = f.rows[Math.floor(f.rows.length / 2)];
    s.hero.x = (row.x0 + row.x1) / 2 + 0.5;
    s.hero.y = row.y + 0.5;
    s.hero.inv = 0;
    let seen = -1;
    let hp = s.hero.hp;
    let early = false;
    let hit = false;
    run(s, 12, () => {
      const z = s.strikes.find((q) => q.art === 'f6_steam' && Math.abs(q.y - s.hero.y) < 0.1);
      if (z && seen < 0) {
        seen = s.time;
        hp = s.hero.hp;
      }
      if (seen > 0 && s.time < seen + FIELD.warn - 0.03 && s.hero.hp < hp) early = true;
      if (seen > 0 && s.hero.hp < hp) hit = true;
      return hit;
    });
    expect(seen).toBeGreaterThan(0);
    expect(early).toBe(false);
    expect(hit).toBe(true);
  });

  it('мост рушится за спиной, под героем — никогда, и застывает снова', () => {
    const s = sim(8, 5, 31.5, 190);
    const br = f6State(s).bridge!;
    expect(br).not.toBeNull();
    const south = br.ys[0] + 0.5;
    const north = br.ys[br.ys.length - 1] - 0.5;
    s.hero.x = br.cx;
    s.hero.y = south;
    let fell = false;
    // Идёт на север три клетки в секунду.
    for (let t = 0; t < 30 * 60; t++) {
      godMode(s);
      if (s.hero.y > north - 1) s.hero.y -= 3 * DT;
      s.hero.x = br.cx;
      stepSim(s, DT, NO_INPUT);
      if (tileAt(s, s.hero.x, s.hero.y) === Tile.Deep) fell = true;
      if (br.state === 'gone') break;
    }
    expect(fell).toBe(false);
    expect(br.state).toBe('gone');
    // Весь мост — лава.
    for (const r of br.rows) for (const i of r) expect(s.tiles[i]).toBe(Tile.Deep);
    // Ушёл далеко — через полминуты мост снова есть.
    s.hero.y = north - 20;
    run(s, BRIDGE.regrow + 3, (s2) => {
      godMode(s2);
    });
    expect(br.state).toBe('idle');
    for (const r of br.rows) for (const i of r) expect(s.tiles[i]).not.toBe(Tile.Deep);
  });

  it('извержение заливает кольца, но не клетку под героем, и отступает с наградой', () => {
    const s = sim(8, 5, 30, 77);
    const e = f6State(s).erupt!;
    expect(e).not.toBeNull();
    // Герой встаёт на клетку ВНЕШНЕГО кольца — её нельзя залить, пока он там.
    const ring0 = e.rings[0];
    const mine = ring0[Math.floor(ring0.length / 3)];
    s.hero.x = e.cx;
    s.hero.y = e.cy;
    let under = false;
    for (let t = 0; t < 60 * 60 && e.state !== 'hold'; t++) {
      godMode(s);
      if (e.state === 'rise' && e.stage >= 1 && e.t < ERUPT.warn + 3) {
        s.hero.x = (mine % W) + 0.5;
        s.hero.y = Math.floor(mine / W) + 0.5;
      } else if (e.state === 'rise' && e.stage >= 1) {
        s.hero.x = e.cx;
        s.hero.y = e.cy;
      }
      stepSim(s, DT, NO_INPUT);
      if (tileAt(s, s.hero.x, s.hero.y) === Tile.Deep) under = true;
    }
    expect(under).toBe(false);
    expect(e.state).toBe('hold');
    let flooded = 0;
    for (const r of e.rings) for (const i of r) if (s.tiles[i] === Tile.Deep) flooded++;
    expect(flooded).toBeGreaterThan(e.rings.flat().length * 0.8);
    const core = s.sack.mats.f6_core ?? 0;
    let dropped = false;
    run(s, ERUPT.hold + 1, (s2) => {
      godMode(s2);
      if (s2.drops.some((d) => d.kind === 'f6_core')) dropped = true;
    });
    expect(e.state).toBe('idle');
    for (const r of e.rings) for (const i of r) expect(s.tiles[i]).not.toBe(Tile.Deep);
    expect(s.world.mark[mine]).toBe(F6_MARK.cooled);
    // Награда из застывшей середины: упала или уже в рюкзаке.
    expect(dropped || (s.sack.mats.f6_core ?? 0) > core).toBe(true);
  });
});
