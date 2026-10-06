// Этаж 15 «Ядро подземелья», половина «Мир»: договор с «Сердцем», карта,
// гравитация (колодцы, отбив, невесомость, орбиты, якорь), свет и двери,
// честность ударов, проходимость ботом.
//
// Подробный журнал прохода: F15LOG=1 npx vitest run src/lib/dungeon-floors/f15.test.ts
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
  useObject as operate,
} from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import { FLOORS } from './index';
import { F15_BEASTS, F15_MARK, F15_OBS, F15_ORBIT, F15_ROOTS } from './f15';
import { F15_JOIN } from './f15-boss';
import {
  ASTRO,
  COMET,
  CONSTEL,
  ECHO,
  EVENT,
  f15State,
  FLOAT,
  GRAVITON,
  METEOR,
  MOON,
  NOVA,
  ORBIT,
  PARRY,
  URCHIN,
  WELL,
} from './f15-brains';
import type { F15State, Well } from './f15-brains';

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
    s.sack.meat.f15_ration = meat;
    s.sack.meatBy[F15_ROOTS] = meat;
  }
  return s;
}

const st = (s: Sim): F15State => {
  const v = f15State(s);
  if (!v) throw new Error('нет состояния этажа');
  return v;
};

const tileOf = (s: Sim, x: number, y: number) => s.tiles[Math.floor(y) * W + Math.floor(x)];
const solidAt = (s: Sim, x: number, y: number) => !walkableTile(tileOf(s, x, y));

function floorNear(s: Sim, x: number, y: number, r: number): [number, number] {
  for (let k = 0; k < 64; k++) {
    const a = k * 2.39996;
    const rr = r * (0.6 + (k % 5) * 0.12);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (tileOf(s, px, py) === Tile.Floor) return [px, py];
  }
  return [x, y];
}

/** Поставить колодец в нужную фазу цикла: `state` 2 — тянет с начала. */
function phaseTo(s: Sim, w: Well, state: 0 | 2): void {
  const P = w.period;
  const off = P - w.warnT - w.onT;
  const want = state === 2 ? off + w.warnT + 0.05 : 0.05;
  w.phase = (((want - s.time) % P) + P) % P;
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

function notice(b: BotState, key: string): [number, boolean] {
  b.seen ??= new Map();
  let v = b.seen.get(key);
  if (!v) {
    const r = () => {
      b.seed = (Math.imul(b.seed, 1664525) + 1013904223) >>> 0;
      return b.seed / 4294967296;
    };
    v = [b.react[0] + r() * (b.react[1] - b.react[0]), r() < b.miss];
    b.seen.set(key, v);
    if (b.seen.size > 400) b.seen.clear();
  }
  return v;
}

const go = (inp: SimInput, x: number, y: number) => {
  const l = Math.hypot(x, y) || 1;
  inp.mx = x / l;
  inp.my = y / l;
  return inp;
};

function bot(s: Sim, b: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  const meat = Object.values(s.sack.meat).reduce<number>((a, c) => a + (c ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) inp.eat = true;
  for (const z of s.strikes) {
    if (!z.dmg) continue;
    const left = z.warn - z.t;
    const [react, missed] = notice(b, `s${z.id}`);
    if (missed || z.t < react || !strikeHits(z, h.x, h.y, h.r + 0.25)) continue;
    let ax = h.x - z.x;
    let ay = h.y - z.y;
    if ((z.shape === 'cone' || z.shape === 'line') && z.ang !== undefined) {
      const side = Math.sin((z.ang ?? 0) - Math.atan2(ay, ax)) > 0 ? -1 : 1;
      const a = (z.ang ?? 0) + side * (z.shape === 'line' ? Math.PI / 2 : 1.9);
      ax = Math.cos(a);
      ay = Math.sin(a);
    }
    if (left < 0.22 && h.dashCd <= 0) inp.dash = true;
    return go(inp, ax, ay);
  }
  for (const m of s.mobs) {
    const t = m.tele;
    if (!t || t.shape !== 'line') continue;
    const [react, missed] = notice(b, `l${m.id}:${Math.round((s.time - m.t) * 10)}`);
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
    if (m.danger > 0 && h.dashCd <= 0) inp.dash = true;
    return go(inp, Math.cos(a) * side, Math.sin(a) * side);
  }
  for (const m of s.mobs) {
    const t = m.tele;
    if (!t || t.shape === 'line' || m.mode === 'dying') continue;
    const cx = t.x ?? m.x;
    const cy = t.y ?? m.y;
    const d = Math.hypot(h.x - cx, h.y - cy);
    const R = t.shape === 'ring' ? t.r + (t.w ?? 0.6) : t.r;
    const [react, missed] = notice(b, `w${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (missed || m.t < react || d > R + h.r + 0.3) continue;
    // Кольцо сверхновой: вплотную безопасно — шаг внутрь, если ближе к ядру.
    if (t.shape === 'ring' && d < t.r - 0.2) return go(inp, cx - h.x, cy - h.y);
    if (m.danger > 0 && h.dashCd <= 0) inp.dash = true;
    return go(inp, h.x - cx, h.y - cy);
  }
  for (const z of s.zones) {
    if (!z.dps || z.t < (z.warn ?? 0)) continue;
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d < z.r + h.r) return go(inp, h.x - z.x, h.y - z.y);
  }
  // Ядро колодца жжёт: из сердцевины тянущего — наружу.
  for (const w of st(s).wells) {
    if (w.state === 0) continue;
    const d = Math.hypot(h.x - w.x, h.y - w.y);
    if (d < w.burn + 1.6 && d < w.r) return go(inp, h.x - w.x, h.y - w.y);
  }
  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge' || (m.data.ghost ?? 0) > 0) continue;
    if (m.kind === 'f15_goldbug') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near && nd < 3.6) {
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    // Страж со щитом: спереди не берёт — обойти сбоку.
    if (near.kind === 'f15_graviton' && nd < 3) {
      const toHero = Math.atan2(h.y - near.y, h.x - near.x);
      let df = toHero - near.face;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      if (Math.abs(df) < 1.25) {
        const side = df >= 0 ? 1 : -1;
        const t = toHero + side * 0.9;
        return go(inp, near.x + Math.cos(t) * 1.6 - h.x, near.y + Math.sin(t) * 1.6 - h.y);
      }
    }
    if (nd > SWORD.reach * 0.8 + near.r * 0.5) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
    }
    if (nd < SWORD.reach + near.r && s.time - b.lastAtk > 0.14) {
      inp.attack = true;
      inp.aim = { x: near.x - h.x, y: near.y - h.y };
      b.lastAtk = s.time;
    }
    return inp;
  }
  return inp;
}

/** Клетки с твёрдыми предметами (якорь, лампа, колонна) — бот их обходит. */
const PROPS = new Set(
  world.objs
    .filter((o) => (o.solid ?? 0) > 0 && o.ref?.startsWith('f15_'))
    .map((o) => o.y * W + o.x),
);

/** Поле расстояний до цели (звёздная дверь в карте — пол). */
function field(tx: number, ty: number): Int32Array {
  // Дейкстра на корзинах: невесомость дороже (бот её обходит, если можно).
  const f = new Int32Array(W * world.h).fill(-1);
  const buckets: number[][] = [[ty * W + tx]];
  const best = new Int32Array(W * world.h).fill(1 << 30);
  best[ty * W + tx] = 0;
  for (let c = 0; c < buckets.length; c++) {
    const b = buckets[c];
    if (!b) continue;
    for (const i of b) {
      if (f[i] >= 0) continue;
      f[i] = c;
      for (const d of [1, -1, W, -W]) {
        const j = i + d;
        const t = world.tiles[j];
        if (f[j] >= 0 || !(walkableTile(t) || t === Tile.Gate)) continue;
        // Острова орбит едут: бот обходит кольца по кромке.
        if (world.mark[j] === M.island || PROPS.has(j)) continue;
        const nc = c + (world.mark[j] === M.float ? 5 : 1);
        if (nc >= best[j]) continue;
        best[j] = nc;
        (buckets[nc] ??= []).push(j);
      }
    }
  }
  return f;
}

function follow(s: Sim, f: Int32Array, gx: number, gy: number): SimInput {
  const h = s.hero;
  const i = Math.floor(h.y) * W + Math.floor(h.x);
  let mx = gx + 0.5 - h.x;
  let my = gy + 0.5 - h.y;
  let bestD = f[i] < 0 ? 1e9 : f[i];
  for (const d of [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1]) {
    const j = i + d;
    if (f[j] >= 0 && f[j] < bestD && walkableTile(s.tiles[j])) {
      // По диагонали — только если оба боковых прохода свободны.
      if (Math.abs(d) !== 1 && Math.abs(d) !== W) {
        const a = i + (d > 0 ? (d % W === 1 || d === W + 1 ? 1 : -1) : d === -W + 1 ? 1 : -1);
        const c = i + (d > 0 ? W : -W);
        if (!walkableTile(s.tiles[a]) || !walkableTile(s.tiles[c])) continue;
      }
      bestD = f[j];
      mx = (j % W) + 0.5 - h.x;
      my = Math.floor(j / W) + 0.5 - h.y;
    }
  }
  const n = Math.hypot(mx, my) || 1;
  // В невесомости разгон не гасится — у пустоты бот идёт вполсилы.
  const k = st(s).floating ? 0.55 : 1;
  return { ...NO_INPUT, mx: (mx / n) * k, my: (my / n) * k };
}

// ---------------------------------------------------------------------------
// Договор и карта.
// ---------------------------------------------------------------------------

describe('этаж 15: договор с «Сердцем»', () => {
  const f = FLOORS.find((x) => x.id === 15)!;

  it('районы снизу вверх: Корни → Обсерватория → Пояс орбит → арена; не заготовка', () => {
    expect(f.areas.map((a) => a.id)).toEqual([F15_ROOTS, F15_OBS, F15_ORBIT, 'f15heart']);
    expect(f.draft).toBeUndefined();
    expect(f.mapVer).toBe(3);
    expect(f.areas.slice(0, 3).every((a) => a.level === 9)).toBe(true);
    expect(f.music).toEqual({ explore: 'depths', boss: 'finale' });
  });

  it('стык: верхний ряд Пояса орбит открыт ровно в столбцах F15_JOIN', () => {
    const top = f.areas[2].rows[0];
    for (let x = 0; x < top.length; x++)
      expect(top[x] !== '#', `столбец ${x}`).toBe(x >= F15_JOIN.x0 && x <= F15_JOIN.x1);
  });

  it('id «Мира» — с приставкой f15_; ходовой материал — осколок; видов 11', () => {
    const ours = f.mobs.filter((m) => !m.id.startsWith('f15boss') && !m.id.startsWith('f15b_'));
    for (const m of ours) expect(m.id.startsWith('f15_'), m.id).toBe(true);
    expect(f.mats[0].id).toBe('f15_shard');
    expect(f.mats.some((m) => m.id === 'f15mat')).toBe(true);
    expect(F15_BEASTS.length).toBeGreaterThanOrEqual(9);
    expect(F15_BEASTS).toContain('f15_goldbug');
    expect(MOBS.f15_goldbug.coins).toBeGreaterThan(0);
  });

  it('районы по 260–360 рядов; от лифта Корней до ворот арены есть путь', () => {
    for (const a of f.areas.slice(0, 3)) {
      expect(a.rows.length, a.id).toBeGreaterThanOrEqual(260);
      expect(a.rows.length, a.id).toBeLessThanOrEqual(360);
    }
    const lift = liftOf(world, F15_ROOTS)!;
    const probe = sim(8, 5, lift.x + 0.5, lift.y + 1.5);
    const gate = probe.boss!.gates[0];
    const goal = field(gate % W, Math.floor(gate / W) + 2);
    expect(goal[(lift.y + 1) * W + lift.x]).toBeGreaterThan(300);
  });

  it('у каждого района свои колодцы, у Пояса — кольца орбит, у Обсерватории — дверь и телескопы', () => {
    const lift = liftOf(world, F15_ROOTS)!;
    const s = sim(8, 5, lift.x + 0.5, lift.y + 1.5);
    const v = st(s);
    for (const area of [F15_ROOTS, F15_OBS, F15_ORBIT])
      expect(v.wells.filter((w) => w.area === area).length, area).toBeGreaterThanOrEqual(2);
    expect(v.rings.length).toBeGreaterThanOrEqual(4);
    expect(v.halls.map((h) => h.name).sort()).toEqual([
      'awaken',
      'eclipse',
      'gallery',
      'parade',
      'starfall',
      'storm',
    ]);
    expect(v.doors.length).toBe(1);
    expect(v.scopes.map((x) => x.what).sort()).toEqual(['door', 'sun']);
    expect(v.scopes.every((x) => x.obj)).toBe(true);
    expect(v.lamps.length).toBeGreaterThanOrEqual(6);
    expect(v.charts.length).toBeGreaterThanOrEqual(2);
    expect(v.mems.filter((m) => m.gallery).length).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Гравитация.
// ---------------------------------------------------------------------------

describe('этаж 15: колодцы', () => {
  it('тянущий колодец тянет героя к ядру, ядро жжёт и отбрасывает', () => {
    const lift = liftOf(world, F15_ROOTS)!;
    const probe = sim(8, 5, lift.x + 0.5, lift.y + 1.5);
    const w0 = st(probe).wells.find((w) => w.area === F15_ROOTS && w.kind === 'map')!;
    const s = sim(8, 5, w0.x + w0.r * 0.75, w0.y, 3);
    s.mobs = [];
    const w = st(s).wells.find((x) => x.id === w0.id)!;
    phaseTo(s, w, 2);
    const d0 = Math.hypot(s.hero.x - w.x, s.hero.y - w.y);
    let minD = d0;
    let hp = s.hero.hp;
    for (let t = 0; t < 60 * 2.5; t++) {
      stepSim(s, DT, NO_INPUT);
      minD = Math.min(minD, Math.hypot(s.hero.x - w.x, s.hero.y - w.y));
      hp = Math.min(hp, s.hero.hp);
    }
    expect(minD).toBeLessThan(d0 - 1);
    expect(hp).toBeLessThan(s.stats.maxHp);
    // Ожог — доля здоровья, не больше пары ожогов за тягу.
    expect(s.stats.maxHp - hp).toBeLessThanOrEqual(s.stats.maxHp * WELL.burnFrac * 3 + 1);
  });

  it('тихий колодец не тянет; предупреждение не короче 1 с', () => {
    expect(WELL.warn).toBeGreaterThanOrEqual(1);
    const lift = liftOf(world, F15_ROOTS)!;
    const probe = sim(8, 5, lift.x + 0.5, lift.y + 1.5);
    const w0 = st(probe).wells.find((w) => w.area === F15_ROOTS && w.kind === 'map')!;
    const s = sim(8, 5, w0.x + w0.r * 0.7, w0.y, 3);
    s.mobs = [];
    const w = st(s).wells.find((x) => x.id === w0.id)!;
    phaseTo(s, w, 0);
    const x0 = s.hero.x;
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    expect(Math.abs(s.hero.x - x0)).toBeLessThan(0.05);
  });

  it('колодец гнёт снаряд к ядру', () => {
    const lift = liftOf(world, F15_ROOTS)!;
    const probe = sim(8, 5, lift.x + 0.5, lift.y + 1.5);
    const w0 = st(probe).wells.find((w) => w.area === F15_ROOTS && w.kind === 'map')!;
    const s = sim(8, 5, w0.x, w0.y + w0.r + 6, 3);
    s.mobs = [];
    const w = st(s).wells.find((x) => x.id === w0.id)!;
    phaseTo(s, w, 2);
    const [mx, my] = floorNear(s, w.x - w.r * 0.6, w.y - 0.3, 0.6);
    const m = spawnMob(s, 'f15_astro', mx, my, { mode: 'chase' });
    m.t = 0;
    // Стрела вдоль колодца, мимо ядра: должна завернуть.
    s.shots.push({
      id: 999,
      x: mx + 0.6,
      y: my,
      vx: 6,
      vy: 0,
      r: 0.2,
      dmg: 10,
      life: 2,
      age: 0,
      art: 'f15_starbolt',
      z: 0,
      kind: 'f15_astro',
    });
    const a0 = 0;
    let turned = 0;
    for (let t = 0; t < 20; t++) {
      stepSim(s, DT, NO_INPUT);
      const sh = s.shots.find((x) => x.id === 999);
      if (sh) turned = Math.max(turned, Math.abs(Math.atan2(sh.vy, sh.vx) - a0));
    }
    expect(turned).toBeGreaterThan(0.1);
  });
});

describe('этаж 15: отбив, невесомость, тяжесть', () => {
  it('удар клинком в окно отбивает стрелу — она летит обратно и бьёт стрелка', () => {
    expect(PARRY.window).toBeGreaterThanOrEqual(0.12);
    const [x, y] = at(F15_OBS, 32, 291);
    const s = sim(8, 5, x + 0.5, y + 0.5, 5);
    s.mobs = [];
    s.hero.inv = 99;
    const m = spawnMob(s, 'f15_astro', s.hero.x + 4.5, s.hero.y, { mode: 'chase' });
    m.data.stones = 0;
    let parried = 0;
    const b: BotState = { lastAtk: -9, react: [0, 0], miss: 0, seed: 1 };
    for (let t = 0; t < 60 * 12 && !parried; t++) {
      const inp: SimInput = { ...NO_INPUT };
      const sh = s.shots.find((q) => Math.hypot(q.x - s.hero.x, q.y - s.hero.y) < 1.5);
      if (sh && s.time - b.lastAtk > 0.3) {
        inp.attack = true;
        inp.aim = { x: sh.x - s.hero.x, y: sh.y - s.hero.y };
        b.lastAtk = s.time;
      }
      m.data.stones = 0;
      stepSim(s, DT, inp);
      parried = st(s).parries;
    }
    expect(parried).toBeGreaterThan(0);
  });

  it('в невесомости у пустоты срываешься: доля здоровья и возврат на твёрдое', () => {
    // Клетка невесомости рядом с пустотой.
    let spot: [number, number] | null = null;
    let dir: [number, number] = [0, 0];
    for (let i = 0; i < W * world.h && !spot; i++) {
      if (world.mark[i] !== M.float || world.tiles[i] !== Tile.Floor) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const j = i + dx * 2 + dy * 2 * W;
        if (world.tiles[j] === Tile.Deep && world.tiles[i - dx - dy * W] === Tile.Floor) {
          spot = [(i % W) + 0.5 - dx, Math.floor(i / W) + 0.5 - dy];
          dir = [dx, dy];
          break;
        }
      }
    }
    expect(spot).not.toBeNull();
    const s = sim(8, 5, spot![0], spot![1], 9);
    s.mobs = [];
    s.hero.inv = 0;
    const hp0 = s.hero.hp;
    for (let t = 0; t < 60 * 3 && !st(s).slips; t++)
      stepSim(s, DT, { ...NO_INPUT, mx: dir[0], my: dir[1] });
    expect(st(s).slips).toBe(1);
    expect(s.hero.hp).toBeLessThan(hp0);
    expect(hp0 - s.hero.hp).toBeLessThanOrEqual(s.stats.maxHp * FLOAT.fall + 1);
    expect(solidAt(s, s.hero.x, s.hero.y)).toBe(false);
  });

  it('страж держит щитом удар спереди, из тяжести щит пробивается', () => {
    const [x, y] = at(F15_OBS, 32, 291);
    const s = sim(8, 5, x + 0.5, y + 0.5, 5);
    s.mobs = [];
    s.hero.inv = 99;
    const hitOnce = (m: Mob, face: number): number => {
      m.face = face;
      m.mode = 'recover';
      m.t = 0;
      const hp0 = m.hp;
      for (let t = 0; t < 10; t++) {
        m.face = face;
        stepSim(s, DT, {
          ...NO_INPUT,
          attack: t === 0,
          aim: { x: m.x - s.hero.x, y: m.y - s.hero.y },
        });
      }
      for (let t = 0; t < 40; t++) stepSim(s, DT, NO_INPUT);
      return hp0 - m.hp;
    };
    const m = spawnMob(s, 'f15_graviton', s.hero.x + 1.2, s.hero.y, { mode: 'chase' });
    const front = hitOnce(m, Math.PI);
    m.x = s.hero.x + 1.2;
    m.y = s.hero.y;
    const back = hitOnce(m, 0);
    expect(back).toBeGreaterThan(0);
    expect(front).toBeLessThan(back * 0.3);
    expect(GRAVITON.shield).toBeLessThan(0.3);
  });
});

describe('этаж 15: орбиты, якорь, свет, дверь', () => {
  it('остров кольца везёт героя; клетки кольца меняются по такту', () => {
    const lift = liftOf(world, F15_ROOTS)!;
    const probe = sim(8, 5, lift.x + 0.5, lift.y + 1.5);
    const r0 = st(probe).rings.find((r) => r.name === 'small')!;
    const c0 = r0.cells.find(
      (c) =>
        r0.floor[c.i] &&
        Math.abs(Math.hypot(c.x + 0.5 - r0.cx, c.y + 0.5 - r0.cy) - (r0.r0 + r0.r1) / 2) < 0.7,
    )!;
    const s = sim(8, 5, c0.x + 0.5, c0.y + 0.5, 4);
    s.mobs = [];
    s.hero.inv = 99;
    const r = st(s).rings.find((q) => q.name === 'small')!;
    r.dockLeft = 0;
    const a0 = Math.atan2(s.hero.y - r.cy, s.hero.x - r.cx);
    const floor0 = r.floor.join('');
    for (let t = 0; t < 60 * 3; t++) stepSim(s, DT, NO_INPUT);
    const a1 = Math.atan2(s.hero.y - r.cy, s.hero.x - r.cx);
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    expect(Math.abs(da)).toBeGreaterThan(0.3);
    expect(r.floor.join('')).not.toBe(floor0);
    expect(st(s).slips).toBe(0);
    expect(ORBIT.hold).toBeGreaterThanOrEqual(6);
  });

  it('якорь дёргает героя тросом на остров', () => {
    const lift = liftOf(world, F15_ROOTS)!;
    const probe = sim(8, 5, lift.x + 0.5, lift.y + 1.5);
    const a = probe.world.objs.find((o) => o.ref === 'f15_anchor')!;
    const s = sim(8, 5, a.x + 0.5, a.y + 1.4, 4);
    s.mobs = [];
    let used = false;
    for (let t = 0; t < 60 * 12 && !used; t++) {
      const u = usableNear(s);
      if (u && u.obj.ref === 'f15_anchor') used = operate(s, u);
      stepSim(s, DT, NO_INPUT);
    }
    expect(used).toBe(true);
    for (let t = 0; t < 60; t++) stepSim(s, DT, NO_INPUT);
    expect(s.world.mark[Math.floor(s.hero.y) * W + Math.floor(s.hero.x)]).toBe(M.island);
  });

  it('звёздная дверь закрыта, пока не наведёшь телескоп', () => {
    const lift = liftOf(world, F15_ROOTS)!;
    const probe = sim(8, 5, lift.x + 0.5, lift.y + 1.5);
    const sc = st(probe).scopes.find((x) => x.what === 'door')!;
    const s = sim(8, 5, sc.x, sc.y + 1.2, 4);
    s.mobs = [];
    const d = st(s).doors[0];
    const dy = band(d.area).top + d.y;
    expect(tileOf(s, d.x0 + 0.5, dy + 0.5)).toBe(Tile.Wall);
    const u = usableNear(s);
    expect(u?.label).toBe('Навести телескоп');
    expect(operate(s, u!)).toBe(true);
    for (let t = 0; t < 90; t++) stepSim(s, DT, NO_INPUT);
    for (let x = d.x0; x <= d.x1; x++) expect(tileOf(s, x + 0.5, dy + 0.5)).toBe(Tile.Floor);
  });

  it('затмение: пожиратель во тьме неуязвим, в свете лампы — нет', () => {
    const lift = liftOf(world, F15_ROOTS)!;
    const probe = sim(8, 5, lift.x + 0.5, lift.y + 1.5);
    const hall = st(probe).halls.find((h) => h.name === 'eclipse')!;
    const lamp = st(probe).lamps.find((l) => l.y > hall.y0 && l.y < hall.y1)!;
    const s = sim(8, 5, lamp.x, lamp.y + 1.2, 6);
    s.mobs = [];
    s.hero.inv = 99;
    for (let t = 0; t < 60 * 3; t++) stepSim(s, DT, NO_INPUT);
    expect(st(s).dark).toBeGreaterThan(0.5);
    for (const m of s.mobs) m.hp = 0;
    s.mobs = [];
    const m = spawnMob(s, 'f15_devourer', s.hero.x + 1, s.hero.y, { mode: 'chase' });
    m.data.snuffCd = 99;
    const hp0 = m.hp;
    for (let t = 0; t < 8; t++)
      stepSim(s, DT, {
        ...NO_INPUT,
        attack: t === 0,
        aim: { x: m.x - s.hero.x, y: m.y - s.hero.y },
      });
    expect(m.hp).toBe(hp0);
    const u = usableNear(s);
    expect(u?.label).toBe('Зажечь кристалл');
    operate(s, u!);
    m.x = lamp.x + 0.8;
    m.y = lamp.y + 0.8;
    s.hero.x = lamp.x;
    s.hero.y = lamp.y + 1.4;
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    const hp1 = m.hp;
    for (let t = 0; t < 8; t++)
      stepSim(s, DT, {
        ...NO_INPUT,
        attack: t === 0,
        aim: { x: m.x - s.hero.x, y: m.y - s.hero.y },
      });
    expect(m.hp).toBeLessThan(hp1);
  });
});

// ---------------------------------------------------------------------------
// Монстры.
// ---------------------------------------------------------------------------

/** Точки вдоль пути «лифт → арена» (по одной на ~110 клеток). */
function pathSpots(): [number, number][] {
  const lift = liftOf(world, F15_ROOTS)!;
  const probe = sim(8, 5, lift.x + 0.5, lift.y + 1.5);
  const gate = probe.boss!.gates[0];
  const f = field(gate % W, Math.floor(gate / W) + 2);
  const out: [number, number][] = [];
  let i = (lift.y + 1) * W + lift.x;
  let n = 0;
  while (f[i] > 0) {
    let best = i;
    for (const d of [1, -1, W, -W]) if (f[i + d] >= 0 && f[i + d] < f[best]) best = i + d;
    if (best === i) break;
    i = best;
    if (++n % 110 === 0) out.push([i % W, Math.floor(i / W)]);
  }
  return out;
}

describe('этаж 15: монстры', () => {
  it('монстры этажа не застревают в стенах', () => {
    const kinds = F15_BEASTS;
    const spots = pathSpots()
      .filter((_, i) => i % 2 === 0)
      .slice(0, 8);
    let stuck = 0;
    let checks = 0;
    const why = new Map<string, number>();
    for (let k = 0; k < spots.length; k++) {
      const [x0, y0] = spots[k];
      const s = sim(8, 5, x0 + 0.5, y0 + 0.5, 60 + k, 6);
      s.hero.inv = 3;
      for (let j = 0; j < 6; j++) {
        const [mx, my] = floorNear(s, x0 + 0.5, y0 + 0.5, 2 + (j % 3));
        spawnMob(s, kinds[(k * 3 + j) % kinds.length], mx, my, { mode: 'chase' });
      }
      const b: BotState = { lastAtk: -9, react: [0.25, 0.4], miss: 0.1, seed: k + 1 };
      for (let t = 0; t < 20 * 60; t++) {
        s.hero.hp = Math.max(s.hero.hp, s.stats.maxHp * 0.5);
        stepSim(s, DT, bot(s, b));
        if (t % 10) continue;
        for (const m of s.mobs) {
          if (['dying', 'emerge', 'escape'].includes(m.mode) || m.t < 0) continue;
          if ((m.data.ghost ?? 0) > 0 || MOBS[m.kind].fly) continue;
          checks += 1;
          if (solidAt(s, m.x, m.y)) {
            stuck += 1;
            const key = `${k}:${m.kind}:${m.mode}:${tileOf(s, m.x, m.y)}`;
            why.set(key, (why.get(key) ?? 0) + 1);
          }
        }
      }
    }
    if (LOG) console.log('в стене', [...why]);
    expect(checks).toBeGreaterThan(400);
    expect(stuck).toBeLessThanOrEqual(3);
  });

  it('у каждого удара монстров есть метка не короче 0,4 с', () => {
    for (const k of F15_BEASTS)
      if (k !== 'f15_goldbug') expect(MOBS[k].windup, k).toBeGreaterThanOrEqual(0.4);
    for (const [name, v] of Object.entries({
      'ёж: сворачивается': URCHIN.curl,
      'ёж: раскрывается': URCHIN.open,
      'жук: прицел': METEOR.aim,
      'комета: прицел': COMET.aim,
      'звездочёт: колодец': ASTRO.castWell,
      'звездочёт: стрелы': ASTRO.castBolt,
      'созвездие: линии': CONSTEL.lashWarn,
      'отражение: выпад': ECHO.lunge,
      'отражение: шаг за спину': ECHO.blink,
      'спутник: прицел': MOON.aim,
      'сверхновая: вспышка': NOVA.gather,
      'звездопад: звезда': EVENT.starfall.warn,
      'шторм: смена': EVENT.storm.warn,
      'колодец: предупреждение': WELL.warn,
    }))
      expect(v, name).toBeGreaterThanOrEqual(0.4);
    // Удары-метки на полу во время боя с толпой.
    const arts = new Map<string, number>();
    const [x, y] = at(F15_OBS, 32, 291);
    const s = sim(8, 5, x + 0.5, y + 0.5, 12);
    s.mobs = [];
    for (const [j, kind] of [
      'f15_constel',
      'f15_constel',
      'f15_astro',
      'f15_graviton',
      'f15_nova',
    ].entries()) {
      const [mx, my] = floorNear(s, x + 0.5, y + 0.5, 2.5 + (j % 2));
      const m = spawnMob(s, kind, mx, my, { mode: 'chase' });
      m.hx = mx;
      m.hy = my;
    }
    for (let t = 0; t < 20 * 60; t++) {
      s.hero.hp = s.stats.maxHp;
      stepSim(s, DT, NO_INPUT);
      for (const z of s.strikes)
        if (z.dmg && !arts.has(z.art ?? z.shape)) arts.set(z.art ?? z.shape, z.warn);
      for (const m of s.mobs)
        if (m.danger > 0 && m.tele) {
          // Опасность включается только в конце видимого замаха.
          expect(m.tele.k, `${m.kind}:${m.mode}`).toBeGreaterThan(0.5);
        }
    }
    if (LOG) console.log('метки', [...arts]);
    for (const [art, warn] of arts) expect(warn, art).toBeGreaterThanOrEqual(0.4);
  });

  it('сверхновая, погибнув, схлопывается в колодец', () => {
    const [x, y] = at(F15_OBS, 32, 291);
    const s = sim(8, 5, x + 0.5, y + 0.5, 12);
    s.mobs = [];
    s.hero.inv = 99;
    const m = spawnMob(s, 'f15_nova', s.hero.x + 1.4, s.hero.y, { mode: 'chase' });
    const n0 = st(s).wells.length;
    for (let t = 0; t < 60 * 30 && m.mode !== 'dying'; t++) {
      stepSim(s, DT, {
        ...NO_INPUT,
        attack: t % 9 === 0,
        aim: { x: m.x - s.hero.x, y: m.y - s.hero.y },
      });
      s.hero.hp = s.stats.maxHp;
    }
    expect(m.mode).toBe('dying');
    for (let t = 0; t < 30; t++) stepSim(s, DT, NO_INPUT);
    expect(st(s).wells.some((w) => w.kind === 'nova')).toBe(true);
    expect(st(s).wells.length).toBe(n0 + 1);
  });
});

// ---------------------------------------------------------------------------
// Проходимость.
// ---------------------------------------------------------------------------

describe('этаж 15: проходимость', () => {
  it('от лифта Корней через Обсерваторию и Пояс орбит до ворот арены на Т8+5 с едой', () => {
    const lift = liftOf(world, F15_ROOTS)!;
    const probe = sim(8, 5, lift.x + 0.5, lift.y + 1.5, 1);
    const gate = probe.boss!.gates[0];
    const gx = gate % W;
    const gy = Math.floor(gate / W) + 2;
    const goal = field(gx, gy);
    const scope = st(probe).scopes.find((x) => x.what === 'door')!;
    const toScope = field(Math.floor(scope.x), Math.floor(scope.y) + 1);
    const sun = st(probe).scopes.find((x) => x.what === 'sun')!;
    const toSun = field(Math.floor(sun.x), Math.floor(sun.y) + 1);
    let arrived = 0;
    const seeds = process.env.F15SEEDS ? process.env.F15SEEDS.split(',').map(Number) : [71, 72];
    const LIM = 1200 * 60;
    for (const seed of seeds) {
      const s = sim(8, 5, lift.x + 0.5, lift.y + 1.5, seed, 10);
      const b: BotState = { lastAtk: -9, react: [0.22, 0.4], miss: 0.1, seed };
      let t = 0;
      const kills = new Map<string, number>();
      const hurt = new Map<string, number>();
      let lastArea = '';
      let minHp = 1;
      let deaths = 0;
      for (; t < LIM; t++) {
        let inp = bot(s, b);
        const idle = !inp.mx && !inp.my && !inp.attack && !inp.eat && !inp.dash;
        // Затмение: во тьме пожиратели неуязвимы — к большому телескопу
        // (живой игрок прочтёт подсказку на баннере).
        const ec = st(s).halls.find((x) => x.name === 'eclipse')!;
        if (ec.state === 'run' && !inp.dash && !inp.eat) {
          const u = usableNear(s);
          if (u && (u.obj.ref === 'f15_telescope' || u.obj.ref === 'f15_lamp')) operate(s, u);
          else inp = follow(s, toSun, Math.floor(sun.x), Math.floor(sun.y) + 1);
        } else if (idle) {
          // Дверь закрыта, а герой у неё — к телескопу.
          const v = st(s);
          const door = v.doors[0];
          const dy = band(door.area).top + door.y;
          const shut = !door.open && !door.at;
          if (shut && Math.abs(s.hero.y - dy) < 14 && s.hero.y > dy) {
            const u = usableNear(s);
            if (u && u.obj.ref === 'f15_telescope') operate(s, u);
            else inp = follow(s, toScope, Math.floor(scope.x), Math.floor(scope.y) + 1);
          } else inp = follow(s, goal, gx, gy);
        }
        const hp0 = s.hero.hp;
        stepSim(s, DT, inp);
        minHp = Math.min(minHp, s.hero.hp / s.stats.maxHp);
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
            hurt.set(src, (hurt.get(src) ?? 0) + hp0 - s.hero.hp);
          }
          if (process.env.F15TRACE && t % (20 * 60) === 0) {
            const d = goal[Math.floor(s.hero.y) * W + Math.floor(s.hero.x)];
            const near = s.mobs.filter(
              (m) => m.mode !== 'dying' && Math.hypot(m.x - s.hero.x, m.y - s.hero.y) < 7,
            );
            console.log(
              `  · ${(t / 60).toFixed(0)} с ${s.area} ${s.hero.x.toFixed(1)},${(s.hero.y - band(s.area).top).toFixed(1)} до цели ${d}, hp ${Math.round((100 * s.hero.hp) / s.stats.maxHp)}%, рядом ${near.map((m) => m.kind.slice(4) + ':' + m.mode).join(',')}`,
            );
          }
          if (s.area !== lastArea) {
            lastArea = s.area;
            console.log(
              `  ${(t / 60).toFixed(0)} с — ${s.area}, здоровье ${Math.round((100 * s.hero.hp) / s.stats.maxHp)}%, мяса ${s.sack.meat.f15_ration ?? 0}`,
            );
          }
        }
        if (Math.hypot(s.hero.x - gx - 0.5, s.hero.y - gy - 0.5) < 1.5) break;
        if (s.hero.mode === 'dead') {
          deaths += 1;
          break;
        }
      }
      if (LOG) {
        const v = st(s);
        console.log(
          `путь ${seed}: ${deaths ? 'погиб' : t < LIM ? `${(t / 60).toFixed(0)} с` : 'не дошёл'}, убито ${s.killed}, где ${s.area} ${s.hero.x.toFixed(0)},${(s.hero.y - band(s.area).top).toFixed(0)}, мин. здоровье ${Math.round(minHp * 100)}%, мяса ${s.sack.meat.f15_ration ?? 0}, срывов ${v.slips}, отбито ${v.parries}, смято ${v.crushed}, залы ${v.halls.map((h) => h.name + ':' + h.state).join(',')}`,
        );
        console.log(
          '  убиты',
          [...kills]
            .sort((a, c) => c[1] - a[1])
            .map(([k, n]) => `${k}:${n}`)
            .join(' '),
        );
        console.log(
          '  урон от',
          [...hurt]
            .sort((a, c) => c[1] - a[1])
            .map(([k, n]) => `${k}:${Math.round(n)}`)
            .join(' '),
        );
      }
      if (!deaths && t < LIM) arrived += 1;
    }
    expect(arrived).toBeGreaterThanOrEqual(Math.ceil(seeds.length / 2));
  });
});
