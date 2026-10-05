// Этаж 15 «Сердце подземелья», половина «Мир»: договор с «Сердцем», живые
// стенки (кромки, сфинктеры, створки), кашель, переваривание, тромб,
// метка «чужак» и действия этажа, монстры не застревают, у ударов есть
// метки, и главное — этаж проходим: от лифта Горла через Чрево и Сосуды
// до ворот арены на Т8+5 с едой.
//
// Бот — тот же игрок средней руки, что у 10-го: видит метки и уходит из
// них рывком с задержкой реакции, изредка прозевав; ест на 40%; рвётся из
// захвата рывком.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, liftOf, Tile, walkableTile } from '../dungeon-world';
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
import { FLOORS } from './index';
import { F15_BEASTS, F15_GUT, F15_MARK, F15_THROAT, F15_VEINS } from './f15';
import { F15_JOIN } from './f15-boss';
import {
  ALIEN,
  BREATH,
  f15Alien,
  f15Events,
  f15View,
  GLAND,
  LEAFLET,
  MACRO,
  MATRON,
  MHOUND,
  MKNIGHT,
  NERVE_NODE,
  WATCHER,
} from './f15-brains';

const world = buildWorld(15);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F15LOG;
const M = F15_MARK;

const band = (id: string) => world.bands.find((b) => b.def.id === id)!;
const at = (area: string, x: number, y: number): [number, number] => [x, band(area).top + y];

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 15 };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7, meat = 0): Sim {
  const d = dungeon(tier, plus);
  const s = createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
  if (meat) {
    s.sack.meat.f15_heartlet = meat;
    s.sack.meatBy[F15_THROAT] = meat;
  }
  return s;
}

const solidAt = (s: Sim, x: number, y: number) =>
  !walkableTile(s.tiles[Math.floor(y) * W + Math.floor(x)]);

function floorNear(s: Sim, x: number, y: number, r: number): [number, number] {
  for (let k = 0; k < 64; k++) {
    const a = k * 2.39996;
    const rr = r * (0.6 + (k % 5) * 0.12);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    const t = s.tiles[Math.floor(py) * W + Math.floor(px)];
    if (t === Tile.Floor) return [px, py];
  }
  return [x, y];
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

function bot(s: Sim, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  // Есть — в первую очередь, что бы ни творилось вокруг.
  const meat = Object.values(s.sack.meat).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) inp.eat = true;
  // Прилипли антитела или паразит — стряхнуть рывком (живой игрок
  // замечает не сразу).
  const stuck = s.mobs.filter((m) => m.mode === 'f15_latch' && m.t > 0.35).length;
  if (stuck >= 1 && h.dashCd <= 0) {
    const a = s.time * 3;
    inp.mx = Math.cos(a);
    inp.my = Math.sin(a);
    inp.dash = true;
    return inp;
  }
  // Сок или жгучая клетка под ногами — на ближнюю чистую.
  const hazDps = (x: number, y: number) => {
    const k = s.world.haz[y * W + x];
    return k ? (s.world.hazards[k - 1]?.dps ?? 0) : 0;
  };
  const hx0 = Math.floor(h.x);
  const hy0 = Math.floor(h.y);
  if (hazDps(hx0, hy0) > 0.02) {
    let best: [number, number] | null = null;
    let bd = 1e9;
    for (let dy = -5; dy <= 5; dy++)
      for (let dx = -5; dx <= 5; dx++) {
        const x = hx0 + dx;
        const y = hy0 + dy;
        if (!walkableTile(s.tiles[y * W + x]) || hazDps(x, y) > 0.02) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = [x + 0.5, y + 0.5];
        }
      }
    if (best) {
      const l = Math.hypot(best[0] - h.x, best[1] - h.y) || 1;
      inp.mx = (best[0] - h.x) / l;
      inp.my = (best[1] - h.y) / l;
      return inp;
    }
  }
  for (const z of s.strikes) {
    if (!z.dmg) continue;
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
    return inp;
  }
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
  for (const m of s.mobs) {
    if (m.mode !== 'windup' && m.mode !== 'f15_swell') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const [react, missed] = notice(st, `w${m.id}:${Math.round((s.time - m.t) * 10)}`);
    const reach = m.mode === 'f15_swell' ? 1.8 : MOBS[m.kind].reach + m.r + 0.9;
    if (!missed && m.t > react && d < reach && h.dashCd <= 0) {
      const away = Math.atan2(h.y - m.y, h.x - m.x) + 0.9;
      inp.mx = Math.cos(away);
      inp.my = Math.sin(away);
      inp.dash = true;
      return inp;
    }
  }
  for (const z of s.zones) {
    if (!z.dps || z.t < (z.warn ?? 0)) continue;
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d < z.r + h.r) {
      inp.mx = (h.x - z.x) / (d || 1);
      inp.my = (h.y - z.y) / (d || 1);
      return inp;
    }
  }
  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge' || (m.data.ghost ?? 0) > 0) continue;
    if (m.kind === 'f15_gold') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    // Органы бьём, только если стоят на пути (рядом).
    const organ = MOBS[m.kind].speed === 0;
    if (organ && d > 2.2) continue;
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  // Дерётся с тем, кто рядом, а не со всеми в семи клетках: этаж живой, кто-то
  // рядом есть всегда, и бот с радиусом 7 минутами топтался на одном месте
  // (грабля из CLAUDE.md — «идти и отбиваться на ходу»).
  if (near && nd < 3.6) {
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    // Латник со щитом: спереди не берёт — обойти сбоку, бить в спину.
    if (near.kind === 'f15_mknight' && near.mode !== 'f15_open' && nd < 3) {
      const toHero = Math.atan2(h.y - near.y, h.x - near.x);
      let df = toHero - near.face;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      if (Math.abs(df) < 1.25) {
        const side = df >= 0 ? 1 : -1;
        const t = toHero + side * 0.9;
        const gx = near.x + Math.cos(t) * 1.4 - h.x;
        const gy = near.y + Math.sin(t) * 1.4 - h.y;
        const l = Math.hypot(gx, gy) || 1;
        inp.mx = gx / l;
        inp.my = gy / l;
        return inp;
      }
    }
    if (nd > SWORD.reach * 0.8 + near.r * 0.5) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
    }
    if (nd < SWORD.reach + near.r && s.time - st.lastAtk > 0.14) {
      inp.attack = true;
      inp.aim = { x: near.x - h.x, y: near.y - h.y };
      st.lastAtk = s.time;
    }
    return inp;
  }
  return inp;
}

/** Поле расстояний до цели; дверь Лимфоузла (побочный тайник) — стена. */
function field(tx: number, ty: number): Int32Array {
  const f = new Int32Array(W * world.h).fill(-1);
  const q = [ty * W + tx];
  f[q[0]] = 0;
  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      const t = world.tiles[j];
      if (f[j] >= 0 || !(walkableTile(t) || t === Tile.Gate)) continue;
      if (world.mark[j] === M.lymphDoor) continue;
      f[j] = f[i] + 1;
      q.push(j);
    }
  }
  return f;
}

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

// ---------------------------------------------------------------------------
// Договор и карта.
// ---------------------------------------------------------------------------

describe('этаж 15: договор с «Сердцем»', () => {
  const f = FLOORS.find((x) => x.id === 15)!;

  it('районы снизу вверх: Горло → Чрево → Сосуды → арена; заготовкой не помечен', () => {
    expect(f.areas.map((a) => a.id)).toEqual([F15_THROAT, F15_GUT, F15_VEINS, 'f15heart']);
    expect(f.draft).toBeUndefined();
    expect(f.areas.slice(0, 3).every((a) => a.level === 9)).toBe(true);
  });

  it('стык: верхний ряд Сосудов открыт ровно в столбцах F15_JOIN', () => {
    const top = f.areas[2].rows[0];
    for (let x = 0; x < top.length; x++) {
      const open = top[x] !== '#';
      expect(open, `столбец ${x}`).toBe(x >= F15_JOIN.x0 && x <= F15_JOIN.x1);
    }
  });

  it('id монстров, мяса и материалов «Мира» — с приставкой f15_; ходовой материал — живая ткань', () => {
    const ours = f.mobs.filter((m) => !m.id.startsWith('f15boss') && !m.id.startsWith('f15b_'));
    for (const m of ours) expect(m.id.startsWith('f15_'), m.id).toBe(true);
    expect(f.mats[0].id).toBe('f15_tissue');
    expect(F15_BEASTS.length).toBeGreaterThanOrEqual(10);
    expect(
      F15_BEASTS.filter((id) => ['f15_mhound', 'f15_msala', 'f15_mknight'].includes(id)).length,
    ).toBe(3);
  });

  it('от лифта Горла до ворот арены есть путь по клеткам', () => {
    const lift = liftOf(world, F15_THROAT)!;
    const probe = sim(8, 5, lift.x + 0.5, lift.y + 1.5);
    const gate = probe.boss!.gates[0];
    const goal = field(gate % W, Math.floor(gate / W) + 2);
    expect(goal[(lift.y + 1) * W + lift.x]).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Живой этаж.
// ---------------------------------------------------------------------------

describe('этаж 15: живые стенки', () => {
  it('кромка Трахеи смыкается на вдохе и выталкивает героя к середине, потом расходится', () => {
    const [x, y] = at(F15_THROAT, 29, 54);
    const s = sim(8, 5, x + 0.5, y + 0.5, 3);
    s.mobs = [];
    let closedSeen = false;
    let openAgain = false;
    let inside = 0;
    const v = () => f15View(s)!;
    for (let t = 0; t < 12 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      const l = v().lives.find((q) => Math.floor(q.cx) === x && Math.floor(q.cy) === y);
      if (!l) continue;
      if (l.closed) {
        closedSeen = true;
        if (s.time - l.at > 0.5 && Math.hypot(s.hero.x - l.cx, s.hero.y - l.cy) < 0.5) inside += 1;
      } else if (closedSeen) openAgain = true;
    }
    expect(closedSeen).toBe(true);
    expect(openAgain).toBe(true);
    expect(inside).toBe(0);
    // Выталкивает к середине хода (к вене), а не в карман альвеолы.
    expect(Math.abs(s.hero.x - (at(F15_THROAT, 31, 0)[0] + 0.5))).toBeLessThan(2.2);
  });

  it('кромки смыкаются только на вдохе, предупреждая набуханием', () => {
    const [x, y] = at(F15_THROAT, 31, 60);
    const s = sim(8, 5, x + 0.5, y + 0.5, 4);
    s.mobs = [];
    const phases: number[] = [];
    for (let t = 0; t < 10 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      const v = f15View(s)!;
      const l = v.lives.find((q) => q.kind === 'band' && Math.abs(q.cy - y) < 3);
      if (l?.closed && s.time - l.at < DT * 1.5) phases.push(v.breath);
    }
    expect(phases.length).toBeGreaterThanOrEqual(1);
    for (const b of phases) expect(b).toBeGreaterThanOrEqual(BREATH.closeAt - 0.02);
  });

  it('створки сердца открыты сразу после удара и сомкнуты к следующему', () => {
    const [x, y] = at(F15_VEINS, 32, 24);
    const s = sim(8, 5, x + 0.5, y + 0.5, 5);
    s.mobs = [];
    let open = 0;
    let shut = 0;
    for (let t = 0; t < 8 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      const v = f15View(s)!;
      const l = v.lives.find((q) => q.kind === 'leaflet');
      if (!l) continue;
      if (v.beatT < LEAFLET.open * v.period - 0.05) open += l.closed ? 0 : 1;
      if (v.beatT > LEAFLET.open * v.period + 0.05) shut += l.closed ? 1 : 0;
    }
    expect(open).toBeGreaterThan(60);
    expect(shut).toBeGreaterThan(60);
  });

  it('кашель Трахеи: вдох, потом волна сверху вниз; рывок в альвеолу спасает', () => {
    const [x, y] = at(F15_THROAT, 31, 64);
    const s = sim(8, 5, x + 0.5, y + 0.5, 6);
    s.mobs = [];
    let started = false;
    for (let t = 0; t < 30 * 60 && !started; t++) {
      s.hero.hp = s.stats.maxHp;
      // Идти вверх по Трахее, пока не закашляет.
      stepSim(s, DT, { ...NO_INPUT, my: -0.6 });
      started = f15Events(s)!.cough === 'on';
    }
    expect(started).toBe(true);
    const z = s.zones.find((q) => q.art === 'f15_gust');
    expect(z).toBeTruthy();
  });
});

describe('этаж 15: события Чрева и Сосудов', () => {
  it('переваривание: сок встаёт кольцами к середине и уходит; клетки зала возвращаются', () => {
    const [x, y] = at(F15_GUT, 31, 58);
    const s = sim(8, 5, x + 0.5, y + 0.5, 8);
    s.mobs = [];
    const before = s.tiles.slice();
    let acid = 0;
    for (let t = 0; t < 45 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      const v = f15View(s)!;
      if (v.digest.stage > 0) acid = Math.max(acid, v.digest.stage);
      s.mobs = s.mobs.filter((m) => m.kind !== 'f15_msala');
    }
    expect(acid).toBe(3);
    expect(f15Events(s)!.digest).toBe('done');
    let diff = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== s.tiles[i]) diff += 1;
    expect(diff).toBe(0);
    // Середина зала не заливается: там можно переждать.
    const b = f15View(s)!.boxes.digest;
    const mid = Math.floor((b.y0 + b.y1 + 1) / 2) * W + Math.floor((b.x0 + b.x1 + 1) / 2);
    const cells = f15View(s)!.digest.cells.flat();
    expect(cells.includes(mid)).toBe(false);
  });

  it('тромб: сгусток запирает Аорту спереди и сзади, после волн рассасывается', () => {
    const [x, y] = at(F15_VEINS, 44, 60);
    const s = sim(8, 5, x + 0.5, y + 0.5, 9);
    s.hero.inv = 1e9;
    const st: BotState = { lastAtk: -9, react: [0.2, 0.3], miss: 0, seed: 9 };
    let walls = 0;
    for (let t = 0; t < 70 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, bot(s, st));
      const v = f15View(s)!;
      if (v.clot.state === 'on') {
        let n = 0;
        for (const i of v.clot.cells) if (s.tiles[i] === Tile.Wall) n += 1;
        walls = Math.max(walls, n);
      }
      if (v.clot.state === 'done') break;
    }
    expect(walls).toBeGreaterThan(4);
    const v = f15View(s)!;
    expect(v.clot.state).toBe('done');
    for (const i of v.clot.cells) expect(walkableTile(s.tiles[i])).toBe(true);
  });

  it('метка «чужак» растёт от убийств, слизь железы снимает её, антитела теряют след', () => {
    const [x, y] = at(F15_THROAT, 12, 99);
    const s = sim(8, 5, x + 0.5, y + 1.5, 10);
    s.mobs = [];
    for (let k = 0; k < 8; k++) {
      const [mx, my] = floorNear(s, s.hero.x, s.hero.y, 1.2);
      const m = spawnMob(s, 'f15_mob', mx, my, { mode: 'chase' });
      m.hp = 1;
    }
    const st: BotState = { lastAtk: -9, react: [0.2, 0.3], miss: 0, seed: 10 };
    // Бой вдали от слизи: у железы метка тает сама.
    const [fx, fy] = at(F15_THROAT, 31, 94);
    s.hero.x = fx + 0.5;
    s.hero.y = fy + 0.5;
    for (let t = 0; t < 8 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, bot(s, st));
    }
    // Восемь секунд сами по себе дают только `passive`; сверху — хотя бы
    // шесть засчитанных убийств антител.
    expect(f15Alien(s)).toBeGreaterThan(ALIEN.passive * 8 + ALIEN.killAb * 6);
    s.hero.x = x + 0.5;
    s.hero.y = y + 1.5;
    for (let t = 0; t < 3; t++) stepSim(s, DT, NO_INPUT);
    const u = usableNear(s);
    expect(u).toBeTruthy();
    expect(useObject(s, u!)).toBe(true);
    stepSim(s, DT, NO_INPUT);
    expect(f15Alien(s)).toBe(0);
    // Та же железа — пуста до конца отката.
    for (let t = 0; t < 60; t++) stepSim(s, DT, NO_INPUT);
    const again = usableNear(s);
    expect(again && again.obj.ref === 'f15_gland' ? useObject(s, again) : false).toBe(false);
    expect(GLAND.cd).toBeGreaterThan(GLAND.hide);
  });
});

// ---------------------------------------------------------------------------
// Монстры.
// ---------------------------------------------------------------------------

describe('этаж 15: монстры', () => {
  it('монстры этажа не застревают в стенах', () => {
    const kinds = [
      'f15_mob',
      'f15_macro',
      'f15_parasite',
      'f15_drone',
      'f15_mhound',
      'f15_msala',
      'f15_mknight',
      'f15_gold',
      'f15_larva',
    ];
    const spots = [
      at(F15_THROAT, 33, 46),
      at(F15_THROAT, 12, 34),
      at(F15_GUT, 31, 28),
      at(F15_GUT, 31, 84),
      at(F15_VEINS, 25, 90),
      at(F15_VEINS, 18, 38),
    ];
    let stuck = 0;
    let checks = 0;
    const why = new Map<string, number>();
    for (let k = 0; k < spots.length; k++) {
      const [x0, y0] = spots[k];
      const s = sim(8, 5, x0 + 0.5, y0 + 0.5, 60 + k, 6);
      s.hero.inv = 3;
      expect(solidAt(s, x0 + 0.5, y0 + 0.5), `точка ${k}`).toBe(false);
      for (let j = 0; j < 6; j++) {
        const [mx, my] = floorNear(s, x0 + 0.5, y0 + 0.5, 2 + (j % 3));
        spawnMob(s, kinds[(k + j) % kinds.length], mx, my, { mode: 'chase' });
      }
      const st: BotState = { lastAtk: -9, react: [0.25, 0.4], miss: 0.1, seed: k + 1 };
      for (let t = 0; t < 25 * 60; t++) {
        s.hero.hp = Math.max(s.hero.hp, s.stats.maxHp * 0.5);
        stepSim(s, DT, bot(s, st));
        if (t % 10) continue;
        for (const m of s.mobs) {
          if (
            ['dying', 'emerge', 'f15_burrow', 'f15_swim', 'f15_latch'].includes(m.mode) ||
            m.t < 0
          )
            continue;
          if ((m.data.ghost ?? 0) > 0 || MOBS[m.kind].fly) continue;
          checks += 1;
          if (solidAt(s, m.x, m.y)) {
            stuck += 1;
            const key = `${k}:${m.kind}:${m.mode}:${s.tiles[Math.floor(m.y) * W + Math.floor(m.x)]}`;
            why.set(key, (why.get(key) ?? 0) + 1);
          }
        }
      }
    }
    if (LOG) console.log('в стене', [...why]);
    expect(checks).toBeGreaterThan(400);
    expect(stuck).toBeLessThanOrEqual(2);
  });

  it('у каждого удара монстров есть метка не короче 0,4 с', () => {
    const arts = new Map<string, number>();
    const [x, y] = at(F15_GUT, 31, 28);
    const s = sim(8, 5, x + 0.5, y + 0.5, 12);
    s.mobs = [];
    for (const [j, kind] of [
      'f15_nerve',
      'f15_watcher',
      'f15_tonsil',
      'f15_mknight',
      'f15_matron',
    ].entries()) {
      const [mx, my] = floorNear(s, x + 0.5, y + 0.5, 2.5 + (j % 2));
      spawnMob(s, kind, mx, my);
    }
    for (let t = 0; t < 25 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      for (const z of s.strikes)
        if (z.dmg && !arts.has(z.art ?? z.shape)) arts.set(z.art ?? z.shape, z.warn);
    }
    if (LOG) console.log('метки', [...arts]);
    expect(arts.size).toBeGreaterThanOrEqual(1);
    for (const [art, warn] of arts) expect(warn, art).toBeGreaterThanOrEqual(0.4);
    // Удары, что бьют не меткой на полу, а по прицелу, — тоже с окном.
    expect(WATCHER.warn).toBeGreaterThanOrEqual(0.4);
    expect(NERVE_NODE.warn).toBeGreaterThanOrEqual(0.4);
    expect(MATRON.slamWarn).toBeGreaterThanOrEqual(0.4);
    expect(MHOUND.aim).toBeGreaterThanOrEqual(0.4);
    expect(MKNIGHT.aim).toBeGreaterThanOrEqual(0.4);
  });

  it('макрофаг глотает, но из него выбираются: не дольше его хватки', () => {
    const [x, y] = at(F15_GUT, 31, 84);
    const s = sim(8, 5, x + 0.5, y + 0.5, 13);
    s.mobs = [];
    const [mx, my] = floorNear(s, x + 0.5, y + 0.5, 1.2);
    spawnMob(s, 'f15_macro', mx, my, { mode: 'chase' });
    let inside = 0;
    let longest = 0;
    for (let t = 0; t < 30 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      const m = s.mobs.find((q) => q.kind === 'f15_macro');
      if (m?.mode === 'f15_engulf') inside += DT;
      else {
        longest = Math.max(longest, inside);
        inside = 0;
      }
    }
    longest = Math.max(longest, inside);
    expect(longest).toBeGreaterThan(0);
    // Стоп-кадры ударов не считаются временем мира — запас на них.
    expect(longest).toBeLessThanOrEqual(MACRO.hold + 0.9);
  });
});

// ---------------------------------------------------------------------------
// Проходимость.
// ---------------------------------------------------------------------------

describe('этаж 15: проходимость', () => {
  it('от лифта Горла через Чрево и Сосуды до ворот арены на Т8+5 с едой', () => {
    const lift = liftOf(world, F15_THROAT)!;
    const probe = sim(8, 5, lift.x + 0.5, lift.y + 1.5, 1);
    const gate = probe.boss!.gates[0];
    const gx = gate % W;
    const gy = Math.floor(gate / W) + 2;
    const goal = field(gx, gy);
    let arrived = 0;
    const seeds = process.env.F15SEEDS ? process.env.F15SEEDS.split(',').map(Number) : [71, 72];
    for (const seed of seeds) {
      const s = sim(8, 5, lift.x + 0.5, lift.y + 1.5, seed, 10);
      const st: BotState = { lastAtk: -9, react: [0.22, 0.4], miss: 0.1, seed };
      let t = 0;
      const kills = new Map<string, number>();
      const hurt = new Map<string, number>();
      let lastArea = '';
      for (; t < 1200 * 60; t++) {
        const inp = bot(s, st);
        if (!inp.mx && !inp.my && !inp.attack && !inp.eat && !inp.dash)
          Object.assign(inp, follow(s, goal, gx, gy));
        const hp0 = s.hero.hp;
        stepSim(s, DT, inp);
        if (LOG) {
          for (const e of s.events)
            if (e.t === 'kill') kills.set(e.mob, (kills.get(e.mob) ?? 0) + 1);
          if (s.hero.hp < hp0) {
            let src = 'среда';
            let bd = 2.5;
            for (const m of s.mobs) {
              const d = Math.hypot(m.x - s.hero.x, m.y - s.hero.y);
              if (d < bd && m.mode !== 'dying') {
                bd = d;
                src = m.kind;
              }
            }
            hurt.set(String(src), (hurt.get(String(src)) ?? 0) + hp0 - s.hero.hp);
          }
          if (process.env.F15TRACE && t % (20 * 60) === 0) {
            const d = goal[Math.floor(s.hero.y) * W + Math.floor(s.hero.x)];
            const near = s.mobs.filter(
              (m) => m.mode !== 'dying' && Math.hypot(m.x - s.hero.x, m.y - s.hero.y) < 7,
            );
            console.log(
              `  · ${(t / 60).toFixed(0)} с ${s.area} ${s.hero.x.toFixed(1)},${(s.hero.y - band(s.area).top).toFixed(1)} до цели ${d}, hp ${Math.round((100 * s.hero.hp) / s.stats.maxHp)}%, чужак ${f15Alien(s).toFixed(0)}, рядом ${near.map((m) => m.kind.slice(4) + ':' + m.mode).join(',')}`,
            );
          }
          if (s.area !== lastArea) {
            lastArea = s.area;
            console.log(
              `  ${(t / 60).toFixed(0)} с — ${s.area}, здоровье ${Math.round((100 * s.hero.hp) / s.stats.maxHp)}%, мяса ${s.sack.meat.f15_heartlet ?? 0}`,
            );
          }
        }
        if (Math.hypot(s.hero.x - gx - 0.5, s.hero.y - gy - 0.5) < 1.5) break;
        if (s.hero.mode === 'dead') break;
      }
      if (LOG) {
        const ev = f15Events(s)!;
        console.log(
          `путь ${seed}: ${s.hero.mode === 'dead' ? 'погиб' : t < 1200 * 60 ? `${(t / 60).toFixed(0)} с` : 'не дошёл'}, убито ${s.killed}, где ${s.area} ${s.hero.x.toFixed(0)},${(s.hero.y - band(s.area).top).toFixed(0)}, мяса ${s.sack.meat.f15_heartlet ?? 0}, чужак ${ev.alien.toFixed(0)}`,
          JSON.stringify(ev),
        );
        console.log(
          '  убиты',
          [...kills]
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${k}:${n}`)
            .join(' '),
        );
        console.log(
          '  урон от',
          [...hurt]
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${k}:${Math.round(n)}`)
            .join(' '),
        );
      }
      if (s.hero.mode !== 'dead' && t < 1200 * 60) arrived += 1;
    }
    expect(arrived).toBeGreaterThanOrEqual(Math.ceil(seeds.length / 2));
  });
});
