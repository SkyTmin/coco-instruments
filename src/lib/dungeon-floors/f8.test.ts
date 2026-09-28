// Этаж 8 «Бесконечный замок»: бот против Демона семи лун, выход с арены,
// сдвиги комнат (никого не замуровывает), Барабанная, Перевёрнутая комната,
// рушащийся мост, нити пауков, глаза в сёдзи, бива.
//
// Бот — живой игрок средней руки: видит метки на полу и уходит из них
// рывком за миг до удара (с задержкой реакции и изредка проглядев), уходит
// вбок от линий прицела и летящих серпов, ест, когда здоровья меньше 40%,
// а босса бьёт в окна — после веера, выпада и серии.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, liftOf, Tile, walkableTile } from '../dungeon-world';
import {
  createSim,
  lineOfSight,
  NO_INPUT,
  spawnMob,
  stepSim,
  strikeHits,
  SWORD,
} from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import {
  BOSS8,
  FALL_HURT,
  FLIP_ARM,
  FLIP_WARN,
  NOTCHES8,
  PLANK_BACK,
  THREAD,
  f8Bridge,
  f8Drum,
  f8Flip,
  f8Groups,
  f8State,
} from './f8-brains';
import { F8_HALLS, F8_LOWER, F8_MARK, F8_MOON } from './f8';

const world = buildWorld(8);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F8LOG;

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 8 };
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
    s.sack.meat.f8_onigiri = meat;
    s.sack.meatBy[F8_LOWER] = meat;
  }
  return s;
}

const bandOf = (area: string) => world.bands.find((b) => b.def.id === area)!;

/** Проходима ли клетка сейчас (пропасть — нет). */
const open = (s: Sim, i: number) => walkableTile(s.tiles[i]) || s.tiles[i] === Tile.Gate;
const solid = (s: Sim, x: number, y: number) =>
  !walkableTile(s.tiles[Math.floor(y) * W + Math.floor(x)]);
const wallAt = (s: Sim, x: number, y: number) =>
  s.tiles[Math.floor(y) * W + Math.floor(x)] === Tile.Wall;

/** Поле расстояний до цели по ТЕКУЩИМ клеткам мира (стены ходят). */
function field(s: Sim, tx: number, ty: number): Int32Array {
  const f = new Int32Array(W * world.h).fill(-1);
  // Вещи с телом (ступени, доспехи, столики) обходятся, как стены.
  const block = new Set<number>();
  for (const p of s.props)
    if (p.alive && p.r >= 0.25) block.add(Math.floor(p.y) * W + Math.floor(p.x));
  const q = [ty * W + tx];
  f[q[0]] = 0;
  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      if (j < 0 || j >= f.length || f[j] >= 0 || !open(s, j) || block.has(j)) continue;
      f[j] = f[i] + 1;
      q.push(j);
    }
  }
  return f;
}

interface BotState {
  lastAtk: number;
  react: [number, number];
  miss: number;
  seed: number;
  seen?: Map<string, [number, boolean]>;
  minHp: number;
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

/** Направление, в котором не упрёшься в стену через шаг. */
function freeDir(s: Sim, ax: number, ay: number): [number, number] {
  const h = s.hero;
  const l = Math.hypot(ax, ay) || 1;
  const ux = ax / l;
  const uy = ay / l;
  if (!solid(s, h.x + ux * 1.1, h.y + uy * 1.1)) return [ux, uy];
  // Упёрся — вдоль стены, куда свободнее.
  for (const turn of [0.8, -0.8, 1.6, -1.6, 2.4, -2.4]) {
    const a = Math.atan2(uy, ux) + turn;
    if (!solid(s, h.x + Math.cos(a) * 1.1, h.y + Math.sin(a) * 1.1))
      return [Math.cos(a), Math.sin(a)];
  }
  return [ux, uy];
}

/**
 * Бот. Порядок: метки ударов → линии прицела → летящее → выпады →
 * замах вплотную → лужи → еда → бой → путь.
 */
function bot(s: Sim, goal: Int32Array | null, st: BotState): SimInput {
  const h = s.hero;
  st.minHp = Math.min(st.minHp, h.hp / s.stats.maxHp);
  const inp: SimInput = { ...NO_INPUT };
  const go = (ax: number, ay: number, dash = false) => {
    const [mx, my] = freeDir(s, ax, ay);
    inp.mx = mx;
    inp.my = my;
    if (dash && h.dashCd <= 0) inp.dash = true;
    return inp;
  };
  // Удары по площади: задевает — в ближайшее безопасное место (просвет
  // веера, промежуток между кольцами), в последний миг — рывком.
  const danger: {
    shape: 'circle' | 'ring' | 'cone' | 'line';
    x: number;
    y: number;
    r: number;
    w?: number;
    ang?: number;
    arc?: number;
    warn: number;
    t: number;
    dmg: number;
  }[] = s.strikes.filter((z) => {
    const [react, missed] = notice(st, `s${z.id}`);
    return !missed && z.t >= react;
  });
  // Летящее — как удар по линии вперёд на 0,6 с полёта.
  for (const p of s.shots) {
    const [react, missed] = notice(st, `p${p.id}`);
    if (missed || p.age < react) continue;
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const along = ((h.x - p.x) * p.vx + (h.y - p.y) * p.vy) / sp;
    danger.push({
      shape: 'line',
      x: p.x,
      y: p.y,
      r: sp * 0.7,
      w: p.r,
      ang: Math.atan2(p.vy, p.vx),
      warn: Math.max(0, along) / sp,
      t: 0,
      dmg: 1,
    });
  }
  const hitBy = (x: number, y: number, pad: number) =>
    danger.filter((z) => strikeHits(z, x, y, h.r + pad));
  const now = hitBy(h.x, h.y, 0.3);
  if (now.length) {
    const left = Math.min(...now.map((z) => z.warn - z.t));
    let best: [number, number] | null = null;
    let bestCost = 1e9;
    for (let r = 0.5; r <= 3.5; r += 0.5)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = h.x + Math.cos(a) * r;
        const y = h.y + Math.sin(a) * r;
        if (solid(s, x, y) || solid(s, h.x + Math.cos(a) * r * 0.5, h.y + Math.sin(a) * r * 0.5))
          continue;
        if (hitBy(x, y, 0.35).length) continue;
        const cost = r;
        if (cost < bestCost) {
          bestCost = cost;
          best = [x - h.x, y - h.y];
        }
      }
    if (best) {
      const walk = Math.hypot(best[0], best[1]) / s.stats.speed;
      return go(best[0], best[1], left < walk + 0.08 || left < 0.24);
    }
    // Некуда — прочь от ближайшего.
    const z = now[0];
    return go(h.x - z.x, h.y - z.y, left < 0.24);
  }
  // Линии прицела мобов — вбок.
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
    return go(Math.cos(a) * side, Math.sin(a) * side, m.danger > 0);
  }
  // Выпад на ходу — не стоять на пути.
  for (const m of s.mobs) {
    if (!['dash', 'lunge', 'leap', 'charge'].includes(m.mode)) continue;
    if (notice(st, `d${m.id}:${Math.round((s.time - m.t) * 10)}`)[1]) continue;
    const ux = Math.cos(m.dir);
    const uy = Math.sin(m.dir);
    const dx = h.x - m.x;
    const dy = h.y - m.y;
    const along = dx * ux + dy * uy;
    const across = -dx * uy + dy * ux;
    if (along > 0 && along < 6 && Math.abs(across) < m.r + h.r + 0.4) {
      const side = across >= 0 ? 1 : -1;
      return go(-uy * side, ux * side, true);
    }
  }
  // Замах вплотную — отскок.
  for (const m of s.mobs) {
    if (m.mode !== 'windup') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const [react, missed] = notice(st, `w${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (!missed && m.t > react && d < MOBS[m.kind].reach + m.r + 0.9 && h.dashCd <= 0) {
      const away = Math.atan2(h.y - m.y, h.x - m.x) + 0.9;
      return go(Math.cos(away), Math.sin(away), true);
    }
  }
  // Горит или вязнет под ногами — отойти.
  for (const z of s.zones) {
    if (!(z.dps || z.slow) || z.t < (z.warn ?? 0)) continue;
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d < z.r + h.r) return go((h.x - z.x) / (d || 1), (h.y - z.y) / (d || 1));
  }
  const meat = Object.values(s.sack.meat).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) inp.eat = true;

  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge' || (m.data.ghost ?? 0) > 0) continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    // За стеной не видно — не лезть к нему сквозь кладку.
    if (d > 1.5 && !lineOfSight(s, h.x, h.y, m.x, m.y)) continue;
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near && near.kind === 'f8boss') {
    // Босс: бить в окна (отдых, после выпада), иначе держать дистанцию
    // в три-четыре клетки — вплотную он режет широким конусом.
    const openW = near.mode === 'recover' || near.mode === 'roar';
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    const reach = SWORD.reach + near.r;
    if (openW) {
      if (nd > reach * 0.8) {
        inp.mx = Math.cos(a);
        inp.my = Math.sin(a);
      }
      if (nd < reach + 0.2 && s.time - st.lastAtk > 0.14) {
        inp.attack = true;
        st.lastAtk = s.time;
      }
      return inp;
    }
    // Идёт на героя — ударить, пока в досягаемости, и отступить.
    if (near.mode === 'chase' && nd < reach + 0.1 && s.time - st.lastAtk > 0.3) {
      inp.attack = true;
      st.lastAtk = s.time;
      return inp;
    }
    if (near.mode === 'chase' && nd < 2.4) return go(-Math.cos(a), -Math.sin(a));
    if (near.mode === 'chase' && nd > 4.5) return go(Math.cos(a), Math.sin(a));
    return inp;
  }
  if (near && nd < 7) {
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    if (nd > SWORD.reach * 0.8) {
      const [mx, my] = freeDir(s, Math.cos(a), Math.sin(a));
      inp.mx = mx;
      inp.my = my;
    }
    if (nd < SWORD.reach + near.r && s.time - st.lastAtk > 0.14) {
      inp.attack = true;
      st.lastAtk = s.time;
    }
    return inp;
  }
  // Горшок или столик на пути — разбить, как сделал бы живой игрок.
  for (const p of s.props) {
    if (!p.alive || !['crate', 'barrel', 'breakable'].includes(p.kind)) continue;
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
    let best = goal[cy * W + cx];
    if (best < 0) best = 1e9;
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

const bossObj = world.objs.find((o) => o.kind === 'boss')!;

/** Бой с Демоном семи лун: время победы или −1. */
function fight(tier: number, plus: number, seed: number, meat = 4) {
  const s = sim(tier, plus, bossObj.x + 0.5, bossObj.y + 6.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.2, 0.42], miss: 0.1, seed, minHp: 1 };
  let won = -1;
  const phases: number[] = [];
  let pits = 0;
  let screens = 0;
  let moons = 0;
  const by: Record<string, number> = {};
  let eaten = 0;
  for (let t = 0; t < 300 * 60; t++) {
    // Кто бьёт: удары, что сработают в этот кадр и задевают героя.
    const due = LOG
      ? s.strikes
          .filter((z) => z.warn - z.t <= DT * 1.01 && strikeHits(z, s.hero.x, s.hero.y, s.hero.r))
          .map((z) => z.art ?? z.shape)
      : [];
    const bossNow = s.mobs.find((m) => m.kind === 'f8boss');
    const modeNow = bossNow?.mode ?? '';
    stepSim(s, DT, bot(s, null, st));
    for (const e of s.events) {
      if (e.t === 'hurt' && LOG) {
        const src =
          due[0] ?? (modeNow === 'dash' ? 'dash' : s.shots.length ? 'shot?' : `other:${modeNow}`);
        by[src] = (by[src] ?? 0) + e.dmg / s.stats.maxHp;
      }
      if (e.t === 'eat') eaten += 1;
      if (e.t !== 'boss') continue;
      if (e.what === 'dead') won = s.time;
      if (e.what === 'phase') phases.push(Math.round(s.time));
      if (e.what === 'f8_pit_wall') pits += 1;
      if (e.what === 'f8_screen_wall') screens += 1;
      if (e.what === 'f8_moons_call') moons += 1;
    }
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  if (LOG)
    console.log(
      `  урон: ${Object.entries(by)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
        .join(', ')}; съедено ${eaten}`,
    );
  if (LOG)
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фазы ${phases.join('/')}, яма ${pits}, ширмы ${screens}, луны ${moons}, мин. здоровье ${Math.round(st.minHp * 100)}%, босс ${Math.round(((s.mobs.find((m) => m.kind === 'f8boss')?.hp ?? 0) / (s.mobs.find((m) => m.kind === 'f8boss')?.maxHp ?? 1)) * 100)}%`,
    );
  return { won, s, st, phases, pits, screens, moons };
}

describe('этаж 8: Демон семи лун', () => {
  it('на Т8+5 бот побеждает за 1–5 минут, но не каждый бой — без потерь', () => {
    const res = [81, 82, 83, 84].map((seed) => fight(8, 5, seed));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(60);
      expect(r.won).toBeLessThan(300);
      // Все четыре фазы и все перемены арены случились.
      expect(r.phases.length).toBe(3);
      expect(r.pits).toBe(1);
      expect(r.screens).toBe(1);
      expect(r.moons).toBe(1);
    }
    // Бой не прогулка: хоть раз бот погиб или опускался ниже половины.
    expect(res.some((r) => r.won < 0 || r.st.minHp < 0.5)).toBe(true);
  });

  it('на Т8 без заточки и без еды — смерть чаще победы', () => {
    const res = [91, 92, 93].map((seed) => fight(8, 0, seed, 0).won);
    expect(res.filter((t) => t > 0).length).toBeLessThanOrEqual(1);
  });

  it('засечки фаз — ровно три, по четвертям', () => {
    expect(NOTCHES8).toEqual([0.75, 0.5, 0.25]);
  });

  it('каждый удар босса виден заранее: метка не короче 0,4 с', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 4.5, 5);
    s.hero.inv = 1e9;
    const lead = () => s.mobs.find((m) => m.kind === 'f8boss')!;
    let seen = 0;
    let short = 0;
    const ids = new Set<number>();
    for (let t = 0; t < 120 * 60; t++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.hp = s.stats.maxHp;
      const b = lead();
      if (!b) break;
      // Прогоняем фазы: срезаем здоровье к каждой засечке.
      if (t === 20 * 60) b.hp = b.maxHp * 0.74;
      if (t === 45 * 60) b.hp = b.maxHp * 0.49;
      if (t === 75 * 60) b.hp = b.maxHp * 0.24;
      for (const z of s.strikes) {
        if (ids.has(z.id)) continue;
        ids.add(z.id);
        seen += 1;
        if (z.warn < 0.4) short += 1;
      }
    }
    expect(seen).toBeGreaterThan(40);
    expect(short).toBe(0);
  });

  it('сброс боя возвращает арену: ямы засыпаны, ширм нет, лун нет', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 4.5, 6);
    s.hero.inv = 1e9;
    const b = () => s.mobs.find((m) => m.kind === 'f8boss')!;
    for (let t = 0; t < 3 * 60; t++) stepSim(s, DT, NO_INPUT);
    expect(s.boss!.state).toBe('fight');
    const before = Array.from(s.boss!.cells).map((i) => s.tiles[i]);
    // Все три перемены арены.
    for (const k of [0.74, 0.49, 0.24]) {
      b().hp = b().maxHp * k;
      for (let t = 0; t < 4 * 60; t++) {
        stepSim(s, DT, NO_INPUT);
        s.hero.hp = s.stats.maxHp;
      }
    }
    expect(s.boss!.phase).toBe(3);
    expect(s.mobs.some((m) => m.kind === 'f8_moon')).toBe(true);
    expect(Array.from(s.boss!.cells).some((i) => s.tiles[i] === Tile.Deep)).toBe(true);
    // Герой пал — бой сброшен, арена прежняя.
    s.hero.inv = 0;
    s.hero.hp = 1;
    for (let t = 0; t < 20 * 60 && s.boss!.state === 'fight'; t++) stepSim(s, DT, NO_INPUT);
    expect(s.boss!.state).not.toBe('fight');
    const after = Array.from(s.boss!.cells).map((i) => s.tiles[i]);
    expect(after).toEqual(before);
    expect(s.mobs.some((m) => m.kind === 'f8_moon' && m.mode !== 'dying')).toBe(false);
  });

  it('перемена арены никого не замуровывает и не роняет в яму', () => {
    const s = sim(8, 5, bossObj.x + 0.5, bossObj.y + 4.5, 7);
    s.hero.inv = 1e9;
    for (let t = 0; t < 2 * 60; t++) stepSim(s, DT, NO_INPUT);
    const cells = Array.from(s.boss!.cells);
    const pit = cells.filter((i) => world.mark[i] === F8_MARK.moonPit);
    const scr = cells.filter((i) => world.mark[i] === F8_MARK.moonScreen);
    expect(pit.length).toBeGreaterThan(8);
    expect(scr.length).toBeGreaterThan(4);
    const b = s.mobs.find((m) => m.kind === 'f8boss')!;
    for (const [k, list] of [
      [0.74, pit],
      [0.49, scr],
    ] as const) {
      b.hp = b.maxHp * k;
      stepSim(s, DT, NO_INPUT);
      // Встать ровно туда, где сейчас вырастет стена или провалится пол.
      const i = list[3];
      for (let t = 0; t < 3 * 60; t++) {
        if (t < 60) {
          s.hero.x = (i % W) + 0.5;
          s.hero.y = Math.floor(i / W) + 0.5;
        }
        stepSim(s, DT, NO_INPUT);
        s.hero.hp = s.stats.maxHp;
      }
      expect(solid(s, s.hero.x, s.hero.y)).toBe(false);
    }
  });
});

describe('этаж 8: арена', () => {
  it('после победы из логова выходят, ворота не захлопываются на герое', () => {
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
    const N = 40;
    for (let k = 0; k < N; k++) {
      const { gate, goal } = targets[k % targets.length];
      const from = cellsIn[(k * 37) % cellsIn.length];
      const s = sim(8, 5, (from % W) + 0.5, Math.floor(from / W) + 0.5, 100 + k);
      s.boss!.state = 'won';
      s.mobs = [];
      // Колонны живой игрок обходит; тест — про ворота.
      const f = field(s, goal % W, Math.floor(goal / W));
      const h = s.hero;
      for (let t = 0; t < 30 * 60; t++) {
        const i = Math.floor(h.y) * W + Math.floor(h.x);
        let mx = 0;
        let my = 0;
        let bestD = f[i];
        for (const d of [1, -1, W, -W]) {
          const j = i + d;
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
      const at = Math.hypot((goal % W) + 0.5 - h.x, Math.floor(goal / W) + 0.5 - h.y) < 0.8;
      if (at) {
        exits += 1;
        expect(s.tiles[gate]).toBe(Tile.Gate);
      }
    }
    expect(exits).toBe(N);
  });
});

describe('этаж 8: замок двигается', () => {
  const hallsTop = bandOf(F8_HALLS).top;

  /** Где встать в Залах: у помоста ядра, чтобы бивы сели играть. */
  function inHalls(seed: number): Sim {
    const g0 = f8Groups(prime(sim(8, 5, 30.5, hallsTop + 40.5, seed)))[0];
    return prime(sim(8, 5, g0.seat!.x, g0.seat!.y + 3, seed));
  }
  function prime(s: Sim): Sim {
    s.hero.inv = 1e9;
    stepSim(s, DT, NO_INPUT);
    return s;
  }

  it('в Залах две группы перегородок, у каждой — помост бивы', () => {
    const s = prime(sim(8, 5, 30.5, hallsTop + 40.5, 1));
    const gs = f8Groups(s);
    expect(gs.length).toBe(2);
    for (const g of gs) {
      expect(g.seat).not.toBeNull();
      expect(g.blocks.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('сдвиг перегородок никого не замуровывает — ни героя, ни демонов', () => {
    const s = inHalls(2);
    let checked = 0;
    for (let round = 0; round < 4; round++) {
      for (const g of f8Groups(s)) {
        // Клетки, что станут стеной в этом сдвиге.
        const next: number[] = [];
        for (const bl of g.blocks)
          for (const c of bl.cells) if (s.tiles[c.i] !== Tile.Wall) next.push(c.i);
        expect(next.length).toBeGreaterThan(0);
        // Герой — на одной, демоны — на других.
        const hi = next[(round * 7) % next.length];
        s.hero.x = (hi % W) + 0.5;
        s.hero.y = Math.floor(hi / W) + 0.5;
        s.mobs = s.mobs.filter((m) => m.kind === 'f8_biwa');
        for (let k = 0; k < 6; k++) {
          const i = next[(k * 13 + 5) % next.length];
          const kind = ['f8_blade', 'f8_arms', 'f8_imp', 'f8_spider'][k % 4];
          spawnMob(s, kind, (i % W) + 0.5, Math.floor(i / W) + 0.5, { mode: 'chase' });
        }
        const before = g.shifts;
        g.at = s.time + 0.01;
        for (let t = 0; t < 20; t++) {
          stepSim(s, DT, NO_INPUT);
          s.hero.hp = s.stats.maxHp;
        }
        expect(g.shifts).toBe(before + 1);
        expect(wallAt(s, s.hero.x, s.hero.y)).toBe(false);
        for (const m of s.mobs) {
          if (m.mode === 'dying' || m.kind === 'f8_biwa') continue;
          checked += 1;
          expect(wallAt(s, m.x, m.y)).toBe(false);
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('при любом положении перегородок Залы проходимы насквозь', () => {
    const s = inHalls(3);
    const band = bandOf(F8_HALLS);
    const lift = liftOf(world, F8_HALLS)!;
    const gs = f8Groups(s);
    for (let combo = 0; combo < 4; combo++) {
      for (const g of gs) {
        const want = g.id === 0 ? combo & 1 : (combo >> 1) & 1;
        if (g.state !== want) {
          g.at = s.time + 0.01;
          for (let t = 0; t < 3; t++) stepSim(s, DT, NO_INPUT);
        }
      }
      const f = field(s, lift.x, lift.y);
      // Верх и низ Залов связаны с лифтом.
      const top = [...Array(W).keys()].map((x) => f[(band.top + 1) * W + x]).filter((v) => v >= 0);
      const bot = [...Array(W).keys()]
        .map((x) => f[(band.top + band.h - 2) * W + x])
        .filter((v) => v >= 0);
      expect(top.length).toBeGreaterThan(0);
      expect(bot.length).toBeGreaterThan(0);
    }
  });

  it('бива играет — стены ходят; убил биву — её крыло замерло', () => {
    const s = inHalls(4);
    const g = f8Groups(s)[0];
    // Ждём, пока бива сядет и хотя бы раз сдвинет стены.
    for (let t = 0; t < 40 * 60 && g.shifts < 1; t++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.hp = s.stats.maxHp;
      s.mobs = s.mobs.filter((m) => m.kind === 'f8_biwa' || m.mode === 'dying');
    }
    expect(g.shifts).toBeGreaterThanOrEqual(1);
    const biwa = s.mobs.find((m) => m.id === g.biwa)!;
    expect(biwa).toBeTruthy();
    // Бьём биву до смерти (исчезать больше некуда).
    biwa.data.vanish = 3;
    for (let t = 0; t < 30 * 60 && biwa.mode !== 'dying'; t++) {
      s.hero.x = biwa.x - 1;
      s.hero.y = biwa.y;
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, { ...NO_INPUT, attack: t % 10 === 0, aim: { x: 1, y: 0 } });
    }
    expect(biwa.mode).toBe('dying');
    expect(g.frozen).toBe(true);
    const n = g.shifts;
    for (let t = 0; t < 45 * 60; t++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.hp = s.stats.maxHp;
    }
    expect(g.shifts).toBe(n);
  });

  it('Барабанная поворачивается ударом в брюхо и никого не замуровывает', () => {
    const s0 = prime(sim(8, 5, 30.5, hallsTop + 40.5, 5));
    const d0 = f8Drum(s0)!;
    expect(d0).not.toBeNull();
    const s = prime(sim(8, 5, d0.cx + 0.5 + 2, d0.cy + 0.5 + 2, 5));
    const d = f8Drum(s)!;
    for (let round = 0; round < 4; round++) {
      const nextArms = d.arms.map(([x, y]) => [-y, x] as [number, number]);
      const now = new Set(d.arms.map(([x, y]) => (d.cy + y) * W + d.cx + x));
      const into = nextArms.map(([x, y]) => (d.cy + y) * W + d.cx + x).filter((i) => !now.has(i));
      expect(into.length).toBeGreaterThan(0);
      const i = into[round % into.length];
      s.hero.x = (i % W) + 0.5;
      s.hero.y = Math.floor(i / W) + 0.5;
      const turns = d.turns;
      d.at = s.time + 0.01;
      for (let t = 0; t < 10; t++) {
        stepSim(s, DT, NO_INPUT);
        s.hero.hp = s.stats.maxHp;
      }
      expect(d.turns).toBe(turns + 1);
      expect(wallAt(s, s.hero.x, s.hero.y)).toBe(false);
    }
    // Барабанщик сам бьёт в брюхо, когда герой в комнате.
    const s2 = prime(sim(8, 5, d0.cx + 0.5 + 2, d0.cy + 0.5 + 2, 6));
    const d2 = f8Drum(s2)!;
    for (let t = 0; t < 30 * 60 && d2.turns < 1; t++) {
      stepSim(s2, DT, NO_INPUT);
      s2.hero.hp = s2.stats.maxHp;
      s2.hero.x = d2.cx + 2.5;
      s2.hero.y = d2.cy + 2.5;
    }
    expect(d2.turns).toBeGreaterThanOrEqual(1);
  });
});

describe('этаж 8: Перевёрнутая комната и мост', () => {
  it('комната предупреждает, переворачивается, никого не замуровывает; с потолка падают', () => {
    const s0 = sim(8, 5, 1, 1, 11);
    stepSim(s0, DT, NO_INPUT);
    const f0 = f8Flip(s0)!;
    expect(f0).not.toBeNull();
    const beam = f0.cells.find((c) => c.kind === 'beam')!;
    const s = sim(8, 5, beam.x + 0.5, beam.y + 0.5, 11);
    s.hero.inv = 1e9;
    let warned = false;
    let flipped = -1;
    for (let t = 0; t < (FLIP_ARM + FLIP_WARN + 1.5) * 60; t++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.hp = s.stats.maxHp;
      const f = f8Flip(s)!;
      if (f.state === 'warn') warned = true;
      if (f.state === 'done' && flipped < 0) flipped = s.time;
      if (flipped < 0) {
        s.hero.x = beam.x + 0.5;
        s.hero.y = beam.y + 0.5;
      }
    }
    expect(warned).toBe(true);
    expect(flipped).toBeGreaterThan(FLIP_ARM + FLIP_WARN - 0.1);
    expect(wallAt(s, s.hero.x, s.hero.y)).toBe(false);
    expect(s.tiles[beam.i]).toBe(Tile.Wall);
    const dropped = s.mobs.filter((m) => m.mode !== 'dying');
    expect(dropped.length).toBeGreaterThanOrEqual(3);
    for (const m of dropped) expect(wallAt(s, m.x, m.y)).toBe(false);
  });

  it('мост рушится за спиной; сорвавшегося возвращает на край с уроном, доски всплывают', () => {
    const s0 = sim(8, 5, 1, 1, 12);
    stepSim(s0, DT, NO_INPUT);
    const br0 = f8Bridge(s0)!;
    expect(br0.rows.length).toBeGreaterThanOrEqual(8);
    // Встать на середину моста и стоять.
    const row = br0.rows[Math.floor(br0.rows.length / 2)];
    const x = row.xs[Math.floor(row.xs.length / 2)] + 0.5;
    const s = sim(8, 5, x, row.y + 0.5, 12);
    s.hero.inv = 0;
    const hp0 = s.hero.hp;
    let fell = false;
    let hpAfter = 0;
    for (let t = 0; t < 12 * 60 && !fell; t++) {
      stepSim(s, DT, NO_INPUT);
      s.mobs = [];
      const br = f8Bridge(s)!;
      if (br.falls > 0) {
        fell = true;
        hpAfter = s.hero.hp;
      }
    }
    expect(fell).toBe(true);
    expect(s.hero.mode).not.toBe('dead');
    expect(solid(s, s.hero.x, s.hero.y)).toBe(false);
    const lost = (hp0 - hpAfter) / s.stats.maxHp;
    expect(lost).toBeGreaterThan(FALL_HURT * 0.6);
    expect(lost).toBeLessThan(FALL_HURT * 1.6);
    // Место возврата — у края моста, на твёрдом.
    const br = f8Bridge(s)!;
    expect(Math.hypot(s.hero.x - br.land[0], s.hero.y - br.land[1])).toBeLessThan(1.5);
    // Доски всплывают.
    for (let t = 0; t < (PLANK_BACK + 6) * 60; t++) {
      stepSim(s, DT, NO_INPUT);
      s.mobs = [];
    }
    for (const r of br.rows)
      for (const bx of r.xs) expect(walkableTile(s.tiles[r.y * W + bx])).toBe(true);
  });

  it('по мосту можно пробежать: бегущий не срывается', () => {
    const s0 = sim(8, 5, 1, 1, 13);
    stepSim(s0, DT, NO_INPUT);
    const br0 = f8Bridge(s0)!;
    const last = br0.rows[br0.rows.length - 1];
    const first = br0.rows[0];
    const x = last.xs[Math.floor(last.xs.length / 2)] + 0.5;
    // С южного края — на север, бегом.
    const s = sim(8, 5, x, last.y + 1.5, 13);
    s.hero.inv = 1e9;
    for (let t = 0; t < 10 * 60 && s.hero.y > first.y - 1.5; t++) {
      stepSim(s, DT, { ...NO_INPUT, my: -1, mx: (x - s.hero.x) * 2 });
      s.mobs = [];
    }
    expect(f8Bridge(s)!.falls).toBe(0);
    expect(s.hero.y).toBeLessThan(first.y);
  });
});

/** Открытое место района: `n` клеток пола вправо и по клетке сверху-снизу. */
function openSpot(area: string, n: number, skip = 0): number {
  const ok: number[] = [];
  for (let y = 2; y < world.h - 2; y++) {
    if (world.rowArea[y] !== area) continue;
    for (let x = 2; x < W - n - 2; x++) {
      const i = y * W + x;
      let good = true;
      for (let k = 0; k <= n && good; k++)
        for (const d of [0, -W, W]) if (world.tiles[i + k + d] !== Tile.Floor) good = false;
      if (good) ok.push(i);
    }
  }
  return ok[(skip * 131) % ok.length];
}

describe('этаж 8: монстры', () => {
  /** Узкие места: пол шириной в клетку-две между стенами. */
  const narrow: number[] = [];
  for (let y = 2; y < world.h - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (world.tiles[i] !== Tile.Floor) continue;
      const o = (j: number) => walkableTile(world.tiles[j]);
      const horiz = !o(i - 1) && o(i + 1) && !o(i + 2);
      const vert = !o(i - W) && o(i + W) && !o(i + 2 * W);
      if (horiz || vert) narrow.push(i);
    }

  it('монстры этажа не застревают в стенах и не падают в пропасть', () => {
    expect(narrow.length).toBeGreaterThan(40);
    const kinds = [
      'f8_imp',
      'f8_blade',
      'f8_arms',
      'f8_spider',
      'f8_drum',
      'f8_miser',
      'f8_lantern',
    ];
    let stuck = 0;
    let checks = 0;
    for (let k = 0; k < 7; k++) {
      const i = narrow[(k * 97 + 13) % narrow.length];
      const x = (i % W) + 0.5;
      const y = Math.floor(i / W) + 0.5;
      const s = sim(8, 5, x, y, 60 + k, 6);
      s.hero.inv = 3;
      for (let j = 0; j < 5; j++) {
        const kind = kinds[(k + j) % kinds.length];
        const a = (j / 5) * Math.PI * 2;
        let mx = x + Math.cos(a) * 3;
        let my = y + Math.sin(a) * 3;
        for (let r = 0; r < 20 && solid(s, mx, my); r++) {
          mx = x + (mx - x) * 0.8;
          my = y + (my - y) * 0.8;
        }
        spawnMob(s, kind, mx, my, { mode: 'chase' });
      }
      const st: BotState = { lastAtk: -9, react: [0.25, 0.4], miss: 0.1, seed: k + 1, minHp: 1 };
      for (let t = 0; t < 40 * 60; t++) {
        stepSim(s, DT, bot(s, null, st));
        if (t % 10) continue;
        for (const m of s.mobs) {
          // Сорвавшийся с рухнувшей доски падает в пропасть — это задумано.
          if (
            m.mode === 'dying' ||
            m.mode === 'emerge' ||
            m.mode === 'escape' ||
            m.t < 0 ||
            (m.data.ghost ?? 0) > 0
          )
            continue;
          checks += 1;
          const fly = MOBS[m.kind].fly;
          if (fly ? wallAt(s, m.x, m.y) : solid(s, m.x, m.y)) {
            stuck += 1;
            if (LOG)
              console.log(
                `застрял ${m.kind} ${m.mode} t${m.t.toFixed(2)} @${m.x.toFixed(2)},${m.y.toFixed(2)} клетка ${s.tiles[Math.floor(m.y) * W + Math.floor(m.x)]} метка ${world.mark[Math.floor(m.y) * W + Math.floor(m.x)]}`,
              );
          }
        }
        if (s.hero.mode === 'dead') break;
      }
    }
    expect(checks).toBeGreaterThan(500);
    expect(stuck).toBe(0);
  });

  it('нить паука вязнет, потом натягивается и режет по линии', () => {
    const i = openSpot(F8_LOWER, 6, 3);
    const s = sim(8, 5, (i % W) + 0.5, Math.floor(i / W) + 0.5, 21);
    for (let t = 0; t < 70; t++) stepSim(s, DT, NO_INPUT);
    s.mobs = [];
    const sp = spawnMob(s, 'f8_spider', s.hero.x + 4, s.hero.y, { mode: 'chase' });
    sp.cd = 0;
    let thread = false;
    let slowed = false;
    let cut = false;
    const x0 = s.hero.x;
    const y0 = s.hero.y;
    let hurt = false;
    for (let t = 0; t < 4 * 60; t++) {
      const hp = s.hero.hp;
      // Стоит на месте, но пытается идти — чтобы увидеть, вязнет ли.
      s.hero.x = x0;
      s.hero.y = y0;
      stepSim(s, DT, NO_INPUT);
      if (s.hero.hp < hp) hurt = true;
      s.hero.hp = s.stats.maxHp;
      if (s.zones.some((z) => z.art === 'f8_thread' && z.slow)) thread = true;
      if (
        s.zones.some(
          (z) => z.art === 'f8_thread' && Math.hypot(z.x - x0, z.y - y0) < z.r + s.hero.r,
        )
      )
        slowed = true;
      if (s.strikes.some((z) => z.art === 'f8_cut' && z.warn >= THREAD.cut - 1e-6)) cut = true;
      if (sp.mode === 'dying') break;
    }
    expect(thread).toBe(true);
    expect(slowed).toBe(true);
    expect(cut).toBe(true);
    expect(hurt).toBe(true);
  });

  it('глаза в сёдзи: пока смотрят — недосягаемы, когти с меткой, потом открыты', () => {
    const s0 = sim(8, 5, 1, 1, 22);
    stepSim(s0, DT, NO_INPUT);
    const eyes = f8State(s0)!.eyes;
    expect(eyes.length).toBeGreaterThanOrEqual(4);
    const e = eyes[0];
    const s = sim(8, 5, e.ox + 0.5, e.oy + 2.2, 22);
    s.hero.inv = 1e9;
    let hidGhost = true;
    let peekGhost = true;
    let claws = false;
    let openHit = false;
    for (let t = 0; t < 12 * 60; t++) {
      stepSim(s, DT, NO_INPUT);
      s.hero.x = e.ox + 0.5;
      s.hero.y = e.oy + 2.2;
      s.hero.hp = s.stats.maxHp;
      for (const m of s.mobs) {
        if (m.kind !== 'f8_eyes') continue;
        if (m.mode === 'f8_hide' && m.data.ghost !== 1) hidGhost = false;
        if (m.mode === 'f8_peek' && m.data.ghost !== 1) peekGhost = false;
        if (m.mode === 'f8_open' && !m.data.ghost) openHit = true;
      }
      if (s.strikes.some((z) => z.art === 'f8_claws' && z.warn >= 0.5)) claws = true;
    }
    expect(hidGhost).toBe(true);
    expect(peekGhost).toBe(true);
    expect(claws).toBe(true);
    expect(openHit).toBe(true);
  });

  it('у каждого монстра этажа удар виден заранее (метка или прицел)', () => {
    for (const kind of ['f8_imp', 'f8_blade', 'f8_arms', 'f8_spider', 'f8_drum', 'f8_lantern']) {
      const i = openSpot(F8_LOWER, 5, 7);
      const s = sim(8, 5, (i % W) + 0.5, Math.floor(i / W) + 0.5, 30);
      for (let t = 0; t < 70; t++) stepSim(s, DT, NO_INPUT);
      s.mobs = [];
      const m = spawnMob(s, kind, s.hero.x + 2.6, s.hero.y, { mode: 'chase' });
      m.cd = 0;
      let warned = false;
      let hitAt = -1;
      for (let t = 0; t < 8 * 60 && hitAt < 0; t++) {
        const hp = s.hero.hp;
        stepSim(s, DT, NO_INPUT);
        if (m.tele || m.danger > 0 || s.strikes.length || ['windup', 'aim'].includes(m.mode))
          warned = true;
        if (s.hero.hp < hp) hitAt = s.time;
        s.hero.hp = s.stats.maxHp;
      }
      expect(warned, kind).toBe(true);
    }
  });
});

describe('этаж 8: путь', () => {
  it('замок проходим: от лифта нижних покоев до ворот логова на Т8+5 с едой', () => {
    const lift = liftOf(world, F8_LOWER)!;
    const gate = world.objs.find((o) => o.kind === 'gate')!;
    let arrived = 0;
    for (const seed of [71, 72]) {
      const s = sim(8, 5, lift.x + 0.5, lift.y + 0.5, seed, 12);
      const st: BotState = { lastAtk: -9, react: [0.22, 0.4], miss: 0.08, seed, minHp: 1 };
      let goal = field(s, gate.x, gate.y + 3);
      let t = 0;
      for (; t < 720 * 60; t++) {
        // Стены ходят — путь пересчитывается раз в секунду.
        if (t % 60 === 0) goal = field(s, gate.x, gate.y + 3);
        if (LOG && t % (30 * 60) === 0)
          console.log(
            `  ${seed} ${(t / 60).toFixed(0)}с: ${s.hero.x.toFixed(1)},${s.hero.y.toFixed(1)} поле ${goal[Math.floor(s.hero.y) * W + Math.floor(s.hero.x)]} мобов ${s.mobs.length} hp ${Math.round((s.hero.hp / s.stats.maxHp) * 100)}%`,
          );
        stepSim(s, DT, bot(s, goal, st));
        if (Math.hypot(s.hero.x - gate.x - 0.5, s.hero.y - gate.y - 3.5) < 1.5) break;
        if (s.hero.mode === 'dead') break;
      }
      if (LOG)
        console.log(
          `путь ${seed}: ${s.hero.mode === 'dead' ? `погиб на ${(t / 60).toFixed(0)} с` : `${(t / 60).toFixed(0)} с`}, убито ${s.killed}, район ${s.area}, y ${s.hero.y.toFixed(0)}`,
        );
      if (s.hero.mode !== 'dead' && t < 720 * 60) arrived += 1;
    }
    expect(arrived).toBe(2);
  });

  it('районы по уровню и порядку: нижние покои, Залы, Зал луны', () => {
    const ids = world.bands.map((b) => b.def.id);
    expect(ids).toContain(F8_LOWER);
    expect(ids).toContain(F8_HALLS);
    expect(ids).toContain(F8_MOON);
    for (const b of world.bands) expect(b.def.level).toBe(9);
    expect(BOSS8.blade[3]).toBeGreaterThan(BOSS8.blade[0]);
  });
});
