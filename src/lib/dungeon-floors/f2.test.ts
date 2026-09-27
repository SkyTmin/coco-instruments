// Этаж 2 «Грибной грот» — свои механики и бой с Живыми доспехами. Бот —
// живой игрок средней руки (как в `dungeon-sim.test.ts`): видит замах и
// метку на полу — уворачивается рывком с задержкой реакции, из облака спор
// выходит, ест на 40% здоровья, бьёт ближайшего.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { bandOf, buildWorld, Tile, walkableTile } from '../dungeon-world';
import {
  createSim,
  NO_INPUT,
  solidTile,
  spawnMob,
  stepSim,
  strikeHits,
  SWORD,
} from '../dungeon-sim';
import type { Mob, Sim, SimEvent, SimInput } from '../dungeon-sim';
import { F2_ARMOR, F2_BLADE, F2_MITE, F2_PLATE, F2_RUIN, MK } from './f2';
import { GATHER_T, MITES0, reformShare, SWARM_T } from './f2-brains';

const world = buildWorld(2);
const DT = 1 / 60;
const W = world.w;

function dungeon(tier: number, plus: number, extra: Partial<DungeonState> = {}): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 2, ...extra };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7): Sim {
  const d = dungeon(tier, plus);
  const s = createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
  s.hero.inv = 0;
  return s;
}

const find = (pred: (o: (typeof world.objs)[number]) => boolean) => world.objs.find(pred)!;
const bossObj = find((o) => o.kind === 'boss');
const ruin = bandOf(world, F2_RUIN)!;
const grot = bandOf(world, 'f2grot')!;

/** Клетки с маркой — места монстров из легенды. */
function marks(mk: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < world.mark.length; i++)
    if (world.mark[i] === mk) out.push({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 });
  return out;
}

/** Пол в `dist` клетках от точки — в ту сторону, где простора больше всего. */
function openAround(
  p: { x: number; y: number },
  dist: number,
): { x: number; y: number; dx: number; dy: number } {
  let best = { x: p.x, y: p.y + dist, dx: 0, dy: 1, room: -1 };
  for (const [dx, dy] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ]) {
    let room = 0;
    for (let k = 1; k <= 7; k++) {
      const x = Math.floor(p.x + dx * k);
      const y = Math.floor(p.y + dy * k);
      if (!walkableTile(world.tiles[y * W + x])) break;
      room = k;
    }
    if (room > best.room) best = { x: p.x + dx * dist, y: p.y + dy * dist, dx, dy, room };
  }
  return best;
}

const ghostly = (m: Mob) =>
  m.mode === 'dying' ||
  m.mode === 'emerge' ||
  m.mode === 'escape' ||
  m.mode === 'drop' ||
  (m.data.ghost ?? 0) > 0;

interface BotState {
  lastAtk: number;
  noEat?: boolean;
  /** Время, с которого бот видит угрозу (реакция). */
  seen: Map<number, number>;
}

const REACT = 0.28;

/** Куда уходить от угрозы в точке (x, y): прочь и чуть вбок. */
function away(s: Sim, x: number, y: number, inp: SimInput): SimInput {
  const h = s.hero;
  let a = Math.atan2(h.y - y, h.x - x) + 0.5;
  // В стену не рвёмся: пробуем стороны.
  for (const off of [0, 0.9, -0.9, 1.8, -1.8, Math.PI]) {
    const b = a + off;
    if (!solidTile(s, Math.floor(h.x + Math.cos(b) * 1.5), Math.floor(h.y + Math.sin(b) * 1.5))) {
      a = b;
      break;
    }
  }
  inp.mx = Math.cos(a);
  inp.my = Math.sin(a);
  return inp;
}

function bot(s: Sim, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  const react = (id: number) => {
    if (!st.seen.has(id)) st.seen.set(id, s.time);
    return s.time - st.seen.get(id)! > REACT;
  };
  // Удары по площади: вот-вот ударит и задевает — рывок прочь.
  for (const k of s.strikes) {
    if (!react(k.id) || !strikeHits(k, h.x, h.y, h.r + 0.25)) continue;
    const left = k.warn - k.t;
    if (left < 0.4 && h.dashCd <= 0) {
      away(s, k.x, k.y, inp);
      if (k.shape === 'line' || k.shape === 'cone') {
        // От линии и конуса — поперёк, а не назад по ним.
        const a = (k.ang ?? 0) + Math.PI / 2;
        const side = Math.sign(Math.cos(a) * (h.x - k.x) + Math.sin(a) * (h.y - k.y)) || 1;
        inp.mx = Math.cos(a) * side;
        inp.my = Math.sin(a) * side;
      }
      inp.dash = true;
      return inp;
    }
    if (left < 0.9) return away(s, k.x, k.y, inp);
  }
  // Замах и метки монстров.
  for (const m of s.mobs) {
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const def = MOBS[m.kind];
    const danger =
      (m.mode === 'windup' && m.t > REACT && d < def.reach + m.r + 0.9) ||
      (m.danger > 0 && d < m.danger && react(-m.id));
    if (danger && h.dashCd <= 0) {
      if (m.tele?.shape === 'line') {
        const a = (m.tele.ang ?? 0) + Math.PI / 2;
        const side = Math.sign(Math.cos(a) * (h.x - m.x) + Math.sin(a) * (h.y - m.y)) || 1;
        inp.mx = Math.cos(a) * side;
        inp.my = Math.sin(a) * side;
      } else away(s, m.x, m.y, inp);
      inp.dash = true;
      return inp;
    }
    if (!m.danger) st.seen.delete(-m.id);
  }
  // Из ядовитого облака — выйти.
  for (const z of s.zones) {
    if (z.status !== 'poison' || z.t < (z.warn ?? 0)) continue;
    if (Math.hypot(z.x - h.x, z.y - h.y) < z.r + 0.4) return away(s, z.x, z.y, inp);
  }
  const food = Object.values(s.sack.meat).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (!st.noEat && h.hp < s.stats.maxHp * 0.4 && food > 0 && h.mode === 'free') inp.eat = true;
  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (ghostly(m) || m.kind === F2_PLATE || m.kind === F2_BLADE) continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near && nd < 9) {
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    if (nd > SWORD.reach * 0.7 + near.r) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
    }
    if (nd < SWORD.reach + near.r && s.time - st.lastAtk > 0.14) {
      inp.attack = true;
      inp.aim = { x: Math.cos(a), y: Math.sin(a) };
      st.lastAtk = s.time;
    }
  }
  return inp;
}

function run(s: Sim, sec: number, onEvent?: (e: SimEvent) => void, stop?: () => boolean) {
  const st: BotState = { lastAtk: -9, seen: new Map() };
  for (let t = 0; t < sec * 60; t++) {
    stepSim(s, DT, bot(s, st));
    for (const e of s.events) onEvent?.(e);
    if (s.hero.mode === 'dead' || stop?.()) break;
  }
}

/** Прошагать мир без ввода. */
function idle(s: Sim, sec: number, input: SimInput = NO_INPUT) {
  for (let t = 0; t < sec * 60; t++) stepSim(s, DT, input);
}

describe('этаж 2: механики грота', () => {
  it('мимик — сундук, пока не подошёл: не бьётся; подошёл — кусает', () => {
    const spot = marks(MK.mimic)[0];
    const s = sim(3, 0, spot.x, spot.y + 5);
    idle(s, 1.2);
    const mimic = s.mobs.find((m) => m.kind === 'f2_mimic')!;
    expect(mimic, 'на месте мимика стоит «сундук»').toBeTruthy();
    expect(mimic.mode).toBe('sleep');
    expect(mimic.data.ghost).toBe(1);
    // Издали его не ударить: для удара героя он — пустое место.
    const hp0 = mimic.hp;
    s.hero.x = spot.x;
    s.hero.y = spot.y + 2.2;
    s.hero.face = -Math.PI / 2;
    stepSim(s, DT, { ...NO_INPUT, attack: true, aim: { x: 0, y: -1 } });
    idle(s, 0.3);
    expect(mimic.hp).toBe(hp0);
    // Подошёл вплотную — просыпается и кусает.
    const heroHp = s.hero.hp;
    s.hero.y = spot.y + 1.4;
    s.hero.inv = 0;
    idle(s, 1.4);
    expect(mimic.mode).not.toBe('sleep');
    expect(mimic.data.ghost).toBe(0);
    expect(s.hero.hp).toBeLessThan(heroHp);
  });

  it('обычный удар режет слизь надвое, тяжёлый давит целиком', () => {
    const cut = sim(3, 0, 30.5, grot.top + 122.5);
    const a = spawnMob(cut, 'f2_slime', cut.hero.x + 1, cut.hero.y, { mode: 'chase' });
    a.cd = 9;
    stepSim(cut, DT, { ...NO_INPUT, attack: true, aim: { x: 1, y: 0 } });
    idle(cut, 0.5);
    const halves = cut.mobs.filter((m) => m.kind === 'f2_slime' && m.mode !== 'dying');
    expect(halves.length).toBe(2);
    expect(halves.every((m) => m.data.gen === 1)).toBe(true);

    const crush = sim(3, 0, 30.5, grot.top + 122.5);
    const b = spawnMob(crush, 'f2_slime', crush.hero.x + 1, crush.hero.y, { mode: 'chase' });
    b.cd = 9;
    // Держать удар — тяжёлый.
    for (let i = 0; i < 70; i++) stepSim(crush, DT, { ...NO_INPUT, attackHeld: true });
    idle(crush, 0.5);
    expect(crush.mobs.filter((m) => m.kind === 'f2_slime' && m.mode !== 'dying').length).toBe(
      b.hp > 0 ? 1 : 0,
    );
  });

  it('мандрагора оглушает в круге; вне круга и рывком сквозь крик — нет', () => {
    const spot = marks(MK.mandrake).find((p) => p.y > grot.top)!;
    const far = openAround(spot, 6);
    const near = openAround(spot, 2);
    const setup = () => {
      const s = sim(3, 3, far.x, far.y);
      idle(s, 0.6);
      s.hero.x = near.x;
      s.hero.y = near.y;
      s.hero.inv = 0;
      return s;
    };
    // Стоит рядом — оглушён.
    const a = setup();
    let stunned = false;
    for (let i = 0; i < 150; i++) {
      stepSim(a, DT, NO_INPUT);
      if (a.hero.status.stun) stunned = true;
    }
    expect(stunned).toBe(true);
    // Вышел из круга, пока кричит, — цел.
    const b = setup();
    let stunB = false;
    for (let i = 0; i < 150; i++) {
      const inRing = b.strikes.some((k) => k.art === 'f2_scream');
      stepSim(b, DT, inRing ? { ...NO_INPUT, mx: near.dx, my: near.dy } : NO_INPUT);
      if (b.hero.status.stun) stunB = true;
    }
    expect(stunB).toBe(false);
    // Рывок в последний миг — сквозь крик, и засчитан уклон.
    const c = setup();
    let stunC = false;
    let dodged = false;
    for (let i = 0; i < 150; i++) {
      const k = c.strikes.find((x) => x.art === 'f2_scream');
      const dash = !!k && k.warn - k.t < 0.12;
      stepSim(c, DT, { ...NO_INPUT, dash, mx: dash ? -near.dx : 0, my: dash ? -near.dy : 0 });
      if (c.hero.status.stun) stunC = true;
      if (c.events.some((e) => e.t === 'dodge')) dodged = true;
    }
    expect(stunC).toBe(false);
    expect(dodged).toBe(true);
  });

  it('гриб-топотун лопается облаком спор — в облаке травит', () => {
    const s = sim(4, 3, 30.5, grot.top + 122.5);
    const m = spawnMob(s, 'f2_shroom', s.hero.x + 1, s.hero.y, { mode: 'chase' });
    m.hp = 1;
    m.cd = 9;
    stepSim(s, DT, { ...NO_INPUT, attack: true, aim: { x: 1, y: 0 } });
    idle(s, 0.2);
    const cloud = s.zones.find((z) => z.art === 'f2_spores' && z.r > 1.2);
    expect(cloud, 'облако после смерти').toBeTruthy();
    s.hero.x = cloud!.x;
    s.hero.y = cloud!.y;
    s.hero.inv = 0;
    idle(s, 0.8);
    expect(s.hero.status.poison).toBeTruthy();
  });

  it('капель со свода: прошёл под ней — сверху падает слизь с меткой', () => {
    const drip = marks(MK.drip).find((p) => p.y > grot.top)!;
    const from = openAround(drip, 4);
    const s = sim(3, 0, from.x, from.y);
    idle(s, 0.2);
    s.hero.x = drip.x;
    s.hero.y = drip.y;
    stepSim(s, DT, NO_INPUT);
    const falling = s.mobs.filter((m) => m.kind === 'f2_slime' && m.mode === 'drop');
    expect(falling.length).toBeGreaterThan(0);
    expect(s.strikes.some((k) => k.art === 'f2_hop' && k.status === 'slow')).toBe(true);
    idle(s, 1);
    expect(s.mobs.some((m) => m.kind === 'f2_slime' && m.mode !== 'drop')).toBe(true);
  });

  it('хваталка бьёт по линии; сбоку от линии — цел', () => {
    const spot = marks(MK.snapper).find((p) => p.y > grot.top)!;
    const at = openAround(spot, 2.2);
    const s = sim(3, 0, at.x, at.y);
    s.hero.inv = 0;
    const hp0 = s.hero.hp;
    for (let i = 0; i < 150; i++) stepSim(s, DT, NO_INPUT);
    expect(s.mobs.some((m) => m.kind === 'f2_snapper')).toBe(true);
    expect(s.hero.hp).toBeLessThan(hp0);
    // Отошёл поперёк линии, когда прицел замер, — промах.
    const t = sim(3, 0, at.x, at.y);
    t.hero.inv = 0;
    const hp1 = t.hero.hp;
    let done = false;
    for (let i = 0; i < 150 && !done; i++) {
      const sn = t.mobs.find((m) => m.kind === 'f2_snapper');
      const aiming = sn?.mode === 'aim' && sn.t > 0.5;
      // Поперёк линии прицела: она идёт от хваталки к герою.
      stepSim(t, DT, aiming ? { ...NO_INPUT, mx: -at.dy, my: at.dx } : NO_INPUT);
      if (sn?.mode === 'retract') done = true;
    }
    expect(done).toBe(true);
    expect(t.hero.hp).toBe(hp1);
  });

  it('монстры не застревают в стенах, воде и колоннах', () => {
    // Грот у ручья и галерея руин среди колонн.
    const spots = [
      [17.5, grot.top + 90.5, 3],
      [17.5, grot.top + 90.5, 4],
      [32.5, ruin.top + 77.5, 5],
    ] as const;
    for (const [x, y, seed] of spots) {
      const s = sim(4, 5, x, y, seed);
      const kinds = ['f2_shroom', 'f2_sprout', 'f2_slime', 'f2_mimic'];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const m = spawnMob(
          s,
          kinds[i % kinds.length],
          s.hero.x + Math.cos(a) * 3,
          s.hero.y + Math.sin(a) * 3,
          {
            mode: 'chase',
          },
        );
        m.data.ghost = 0;
      }
      let bad = 0;
      const st: BotState = { lastAtk: -9, seen: new Map() };
      for (let t = 0; t < 40 * 60; t++) {
        stepSim(s, DT, bot(s, st));
        s.hero.hp = s.stats.maxHp;
        for (const m of s.mobs) {
          if (m.mode === 'emerge' || m.mode === 'drop' || m.t < 0) continue;
          const tile = world.tiles[Math.floor(m.y) * W + Math.floor(m.x)];
          const fly = MOBS[m.kind].fly;
          if (!(walkableTile(tile) || tile === Tile.Gate) && !(fly && tile === Tile.Deep)) bad += 1;
        }
      }
      expect(bad).toBe(0);
    }
  });

  it('грибница прорастает убитого грибёнком', () => {
    const cell = marks(MK.mycel).find((p) => {
      const i = Math.floor(p.y) * W + Math.floor(p.x);
      return walkableTile(world.tiles[i]) && p.y > grot.top;
    })!;
    let sprouted = false;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = sim(4, 3, cell.x - 1, cell.y, seed);
      const m = spawnMob(s, 'f2_slime', cell.x, cell.y, { mode: 'chase' });
      m.hp = 0.5;
      m.data.gen = 1;
      m.cd = 9;
      stepSim(s, DT, { ...NO_INPUT, attack: true, aim: { x: 1, y: 0 } });
      idle(s, 0.3);
      if (!s.zones.some((z) => z.art === 'f2_sprouting')) continue;
      s.mobs = s.mobs.filter((x) => x.kind === 'f2_sprout');
      idle(s, 7);
      if (s.mobs.some((x) => x.kind === 'f2_sprout')) sprouted = true;
      break;
    }
    expect(sprouted).toBe(true);
  });
});

describe('этаж 2: Живые доспехи', () => {
  /** Герой в арене, у ворот — бой начинается. */
  const arenaSim = (tier: number, plus: number, seed: number) =>
    sim(tier, plus, bossObj.x + 0.5, bossObj.y + 6.5, seed);

  it('разбитые латы выпускают рой; не добил вовремя — латы собираются снова', () => {
    const s = arenaSim(4, 3, 5);
    idle(s, 0.2);
    expect(s.boss!.state).toBe('fight');
    const armor = s.mobs.find((m) => m.kind === F2_ARMOR)!;
    armor.hp = 1;
    s.hero.x = armor.x + 1.2;
    s.hero.y = armor.y;
    s.hero.inv = 99;
    const texts: string[] = [];
    const grab = () => {
      for (const e of s.events) if (e.t === 'boss' && e.text) texts.push(e.text);
    };
    stepSim(s, DT, { ...NO_INPUT, attack: true, aim: { x: -1, y: 0 } });
    grab();
    for (let i = 0; i < 20; i++) {
      stepSim(s, DT, NO_INPUT);
      grab();
    }
    expect(texts).toContain('ЛАТЫ РАЗБИТЫ');
    expect(s.mobs.filter((m) => m.kind === F2_MITE && m.mode !== 'dying').length).toBe(MITES0);
    expect(s.mobs.filter((m) => m.kind === F2_PLATE).length).toBe(5);
    expect(s.mobs.some((m) => m.kind === F2_BLADE)).toBe(true);
    // Стоим и ждём: рой не добит — сборка, потом латы на ногах.
    for (let i = 0; i < (SWARM_T[0] + GATHER_T + 1.5) * 60; i++) {
      s.hero.inv = 99;
      stepSim(s, DT, NO_INPUT);
      grab();
    }
    expect(texts).toContain('ДОСПЕХ СОБИРАЕТСЯ');
    expect(texts).toContain('ЛАТЫ СОБРАНЫ');
    const back = s.mobs.find((m) => m.kind === F2_ARMOR && m.mode !== 'dying')!;
    expect(back).toBeTruthy();
    expect(back.hp / back.maxHp).toBeCloseTo(reformShare(MITES0), 2);
    expect(s.mobs.some((m) => m.kind === F2_PLATE || m.kind === F2_BLADE)).toBe(false);
    expect(s.boss!.state).toBe('fight');
  });

  it('добил рой, пока латы лежат, — победа, печать открыта', () => {
    const s = arenaSim(4, 3, 6);
    idle(s, 0.2);
    const armor = s.mobs.find((m) => m.kind === F2_ARMOR)!;
    armor.hp = 1;
    s.hero.x = armor.x + 1.2;
    s.hero.y = armor.y;
    stepSim(s, DT, { ...NO_INPUT, attack: true, aim: { x: -1, y: 0 } });
    idle(s, 0.5);
    let won = false;
    // Рой добивается ударами: каждого латника — насмерть.
    for (let k = 0; k < 40 && !won; k++) {
      const mite = s.mobs.find(
        (m) => m.kind === F2_MITE && m.mode !== 'dying' && m.mode !== 'escape',
      );
      if (!mite) break;
      mite.hp = 0.1;
      s.hero.x = mite.x - 0.8;
      s.hero.y = mite.y;
      s.hero.inv = 99;
      stepSim(s, DT, { ...NO_INPUT, attack: true, aim: { x: 1, y: 0 } });
      for (let i = 0; i < 16; i++) {
        stepSim(s, DT, NO_INPUT);
        if (s.events.some((e) => e.t === 'boss' && e.what === 'dead')) won = true;
      }
    }
    expect(won).toBe(true);
    expect(s.beaten).toBe(true);
    expect(
      s.mobs.some((m) => (m.kind === F2_PLATE || m.kind === F2_BLADE) && m.mode !== 'dying'),
    ).toBe(false);
  });

  it('бот на «Горном мастере» +3 (ступень 4) побеждает за 1–5 минут и не всегда умирает', () => {
    const results: number[] = [];
    for (const seed of [21, 22, 23, 24]) {
      const s = arenaSim(4, 3, seed);
      let won = -1;
      run(
        s,
        300,
        (e) => {
          if (e.t === 'boss' && e.what === 'dead') won = s.time;
        },
        () => won > 0,
      );
      results.push(won);
    }
    if (process.env.F2LOG) console.log('Живые доспехи, время победы по зёрнам:', results);
    const wins = results.filter((t) => t > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    const avg = wins.reduce((a, b) => a + b, 0) / wins.length;
    expect(avg).toBeGreaterThan(60);
    expect(avg).toBeLessThan(300);
  });

  it('на «Кованом» +0 (ступень 3) доспехи сильнее бота', () => {
    let wins = 0;
    for (const seed of [31, 32, 33]) {
      const s = arenaSim(3, 0, seed);
      let won = false;
      run(
        s,
        240,
        (e) => {
          if (e.t === 'boss' && e.what === 'dead') won = true;
        },
        () => won,
      );
      if (won) wins += 1;
    }
    expect(wins).toBeLessThanOrEqual(1);
  });

  it('после победы из тронного зала выходят, ворота не захлопываются на герое', () => {
    const probe = arenaSim(4, 3, 1);
    const b0 = probe.boss!;
    const cellsIn = [...b0.cells].filter((c) => walkableTile(world.tiles[c]));
    // Цель — пол снаружи ворот.
    const gate = b0.gates[1];
    const goal = gate + W * 5;
    expect(walkableTile(world.tiles[goal])).toBe(true);
    const field = new Int32Array(W * world.h).fill(-1);
    const q = [goal];
    field[goal] = 0;
    while (q.length) {
      const i = q.shift()!;
      for (const d of [1, -1, W, -W]) {
        const j = i + d;
        const t = world.tiles[j];
        if (field[j] >= 0 || !(walkableTile(t) || t === Tile.Gate)) continue;
        field[j] = field[i] + 1;
        q.push(j);
      }
    }
    let exits = 0;
    for (let k = 0; k < 40; k++) {
      const from = cellsIn[(k * 53) % cellsIn.length];
      const s = sim(4, 3, (from % W) + 0.5, Math.floor(from / W) + 0.5, 100 + k);
      s.boss!.state = 'won';
      s.mobs = [];
      for (const p of s.props)
        if (b0.cells.has(Math.floor(p.y) * W + Math.floor(p.x))) p.alive = false;
      for (let t = 0; t < 30 * 60; t++) {
        const h = s.hero;
        const i = Math.floor(h.y) * W + Math.floor(h.x);
        let mx = 0;
        let my = 0;
        let best = field[i];
        for (const d of [1, -1, W, -W]) {
          const j = i + d;
          if (field[j] >= 0 && field[j] < best) {
            best = field[j];
            mx = (j % W) + 0.5 - h.x;
            my = Math.floor(j / W) + 0.5 - h.y;
          }
        }
        if (best === field[i]) {
          mx = (goal % W) + 0.5 - h.x;
          my = Math.floor(goal / W) + 0.5 - h.y;
        }
        const n = Math.hypot(mx, my) || 1;
        stepSim(s, DT, { ...NO_INPUT, mx: mx / n, my: my / n });
        s.mobs = [];
        if (Math.hypot((goal % W) + 0.5 - h.x, Math.floor(goal / W) + 0.5 - h.y) < 0.6) break;
      }
      const h = s.hero;
      if (Math.hypot((goal % W) + 0.5 - h.x, Math.floor(goal / W) + 0.5 - h.y) < 0.8) {
        exits += 1;
        expect(s.tiles[gate]).toBe(Tile.Gate);
      }
    }
    expect(exits).toBe(40);
  });

  it('рой и обломки не застревают в стенах арены', () => {
    const s = arenaSim(4, 3, 9);
    idle(s, 0.2);
    const armor = s.mobs.find((m) => m.kind === F2_ARMOR)!;
    armor.hp = 1;
    s.hero.x = armor.x + 1.2;
    s.hero.y = armor.y;
    stepSim(s, DT, { ...NO_INPUT, attack: true, aim: { x: -1, y: 0 } });
    let bad = 0;
    for (let t = 0; t < 25 * 60; t++) {
      s.hero.inv = 99;
      stepSim(s, DT, NO_INPUT);
      for (const m of s.mobs) {
        if (m.mode === 'dying' || m.mode === 'escape' || m.mode === 'air') continue;
        if (solidTile(s, Math.floor(m.x), Math.floor(m.y)) && !MOBS[m.kind].fly) bad += 1;
      }
    }
    expect(bad).toBe(0);
  });
});
