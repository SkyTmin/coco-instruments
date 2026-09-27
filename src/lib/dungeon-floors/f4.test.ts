// Этаж 4 «Двойная крипта»: свои механики и бот против Каменного идола.
// Бот — живой игрок средней руки: слушается скрижали, встаёт на светлую
// плиту во время взора, поворачивается к подкравшейся статуе и бьёт идола,
// когда у того открыт лик. Реакция — не мгновенная (`REACT`).

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, liftOf, Tile, walkableTile } from '../dungeon-world';
import { createSim, NO_INPUT, spawnMob, stepSim, SWORD } from '../dungeon-sim';
import type { Mob, Sim, SimEvent, SimInput } from '../dungeon-sim';
import { idolChip, REFORM, RULES, ST } from './f4-brains';

const world = buildWorld(4);
const W = world.w;
const DT = 1 / 60;

function dungeon(tier: number, plus: number, extra: Partial<DungeonState> = {}): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, ...extra };
}

function sim(tier: number, plus: number, x: number, y: number, seed = 7, meat = 0): Sim {
  const d = dungeon(tier, plus);
  return createSim({
    world,
    dungeon: d,
    stats: heroOf(d),
    x,
    y,
    seed,
    now: () => 1e12,
    sack: {
      meat: meat ? { f4_ration: meat } : {},
      mats: {},
      tokens: 0,
      keys: 0,
      coins: 0,
      meatBy: meat ? { f4sanct: meat } : {},
    },
  });
}

const band = (id: string) => world.bands.find((b) => b.def.id === id)!;
const at = (area: string, x: number, ly: number): [number, number] => [x, band(area).top + ly];
const seat = world.objs.find((o) => o.ref === 'f4_idol')!;
const bossObj = world.objs.find((o) => o.kind === 'boss')!;
const gate = world.objs.find((o) => o.kind === 'gate')!;

/** Шаг без ввода, кроме заданного. */
function step(s: Sim, n: number, inp: Partial<SimInput> = {}, each?: (e: SimEvent) => void): void {
  for (let i = 0; i < n; i++) {
    stepSim(s, DT, { ...NO_INPUT, ...inp });
    if (each) for (const e of s.events) each(e);
  }
}

/** Посмотреть в сторону (крошечный толчок джойстика — как живой игрок). */
function look(s: Sim, ang: number): void {
  stepSim(s, DT, { ...NO_INPUT, mx: Math.cos(ang) * 0.13, my: Math.sin(ang) * 0.13 });
  s.hero.face = ang;
}

function clearMobs(s: Sim): void {
  s.mobs = [];
  s.director.spawnT = 1e9;
  s.director.hordeT = 1e9;
  s.director.goldT = 1e9;
  for (const g of s.groups) g.used = true;
  for (const a of s.ambushes) a.used = true;
}

// ---------------------------------------------------------------------------
// Костяк и кучка костей.
// ---------------------------------------------------------------------------

describe('этаж 4: костяк встаёт, если не добить кучку', () => {
  const spot = at('f4crypt', 31.5, 27.5);

  function killSkel(seed: number): Sim {
    const s = sim(8, 0, spot[0], spot[1], seed);
    clearMobs(s);
    s.hero.inv = 999;
    const sk = spawnMob(s, 'f4_skel', spot[0] + 1, spot[1], { mode: 'chase' });
    sk.hp = 1;
    sk.cd = 99;
    for (let i = 0; i < 60 && sk.mode !== 'dying'; i++)
      stepSim(s, DT, { ...NO_INPUT, attack: i % 20 === 0, aim: { x: 1, y: 0 } });
    expect(sk.mode).toBe('dying');
    return s;
  }

  it('убитый костяк рассыпается кучкой, и она встаёт через несколько секунд', () => {
    const s = killSkel(1);
    const pile = s.mobs.find((m) => m.kind === 'f4_bones');
    expect(pile, 'кучка костей').toBeTruthy();
    // Тот же взмах, что убил, кучку не разбивает.
    step(s, 20);
    expect(pile!.hp).toBeGreaterThan(0);
    step(s, 60 * 5.5);
    expect(pile!.kind).toBe('f4_skel');
    expect(pile!.hp).toBeGreaterThan(0);
    expect(s.mobs.some((m) => m.kind === 'f4_bones')).toBe(false);
  });

  it('добитая кучка не встаёт', () => {
    const s = killSkel(2);
    step(s, 30);
    const pile = s.mobs.find((m) => m.kind === 'f4_bones')!;
    const dir = { x: pile.x - s.hero.x, y: pile.y - s.hero.y };
    let kills = 0;
    for (let i = 0; i < 60 && pile.mode !== 'dying'; i++)
      stepSim(s, DT, { ...NO_INPUT, attack: i % 20 === 0, aim: dir });
    expect(pile.mode).toBe('dying');
    step(s, 60 * 6, {}, (e) => e.t === 'kill' && (kills += 1));
    expect(s.mobs.some((m) => m.kind === 'f4_skel' && m.mode !== 'dying')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Статуи.
// ---------------------------------------------------------------------------

describe('этаж 4: статуи движутся, только пока на них не смотрят', () => {
  // Зал прощания крипты: просторно, и стражи колоннады не вмешиваются.
  const spot = at('f4crypt', 31.5, 26.5);

  function withStatue(dy: number): { s: Sim; m: Mob } {
    const s = sim(8, 0, spot[0], spot[1], 3);
    clearMobs(s);
    step(s, 70);
    const m = spawnMob(s, 'f4_sentry', spot[0], spot[1] + dy, { mode: 'still' });
    m.cd = 0;
    return { s, m };
  }

  it('смотришь — стоит; отвернулся — идёт', () => {
    const { s, m } = withStatue(3.5);
    look(s, Math.PI / 2);
    const y0 = m.y;
    step(s, 180);
    expect(Math.abs(m.y - y0)).toBeLessThan(0.02);
    expect(m.mode).toBe('still');
    look(s, -Math.PI / 2);
    step(s, 40);
    expect(m.mode).toBe('creep');
    expect(y0 - m.y).toBeGreaterThan(1);
  });

  it('замах копится, только пока не смотришь, — посмотрел, и удар не приходит', () => {
    const { s, m } = withStatue(1.2);
    s.hero.inv = 0;
    look(s, -Math.PI / 2);
    for (let i = 0; i < 60 && m.mode !== 'wind'; i++) stepSim(s, DT, NO_INPUT);
    expect(m.mode).toBe('wind');
    step(s, 12);
    look(s, Math.PI / 2);
    const wk = m.data.wk;
    const hp = s.hero.hp;
    step(s, 120);
    expect(m.data.wk).toBeCloseTo(wk, 5);
    expect(s.hero.hp).toBe(hp);
    // Отвернулся — замах дошёл, и удар пришёл.
    look(s, -Math.PI / 2);
    step(s, 60);
    expect(s.hero.hp).toBeLessThan(hp);
  });

  it('застывая, статуя встаёт в новую позу', () => {
    const { s, m } = withStatue(4);
    look(s, -Math.PI / 2);
    step(s, 20);
    const p0 = m.data.pose ?? 0;
    look(s, Math.PI / 2);
    step(s, 5);
    expect(m.mode).toBe('still');
    expect(m.data.pose).toBe((p0 + 1) % 4);
  });
});

// ---------------------------------------------------------------------------
// Латник.
// ---------------------------------------------------------------------------

describe('этаж 4: щит латника', () => {
  const spot = at('f4crypt', 49.5, 64.5);

  function duel(frontal: boolean): { s: Sim; k: Mob } {
    const s = sim(8, 0, spot[0], spot[1], 5);
    clearMobs(s);
    step(s, 70);
    const k = spawnMob(s, 'f4_knight', spot[0] + 1.2, spot[1], { mode: 'guard' });
    k.face = frontal ? Math.PI : 0;
    k.cd = 99;
    k.speed = 0;
    return { s, k };
  }

  function hitOnce(s: Sim, k: Mob): number {
    const hp = k.hp;
    for (let i = 0; i < 30; i++)
      stepSim(s, DT, {
        ...NO_INPUT,
        attack: i === 0,
        aim: { x: k.x - s.hero.x, y: k.y - s.hero.y },
      });
    return hp - k.hp;
  }

  it('в лоб — искры и крохи урона, со спины — полный', () => {
    const f = duel(true);
    const front = hitOnce(f.s, f.k);
    const b = duel(false);
    // Со спины латник поворачивается медленно — успеваем ударить.
    const back = hitOnce(b.s, b.k);
    const dmg = f.s.stats.dmg;
    expect(front).toBeGreaterThan(0);
    expect(front).toBeLessThan(dmg * 0.25);
    expect(back).toBeGreaterThan(dmg * 0.6);
  });

  it('тяжёлый удар выбивает щит: латник оглушён и открыт', () => {
    const { s, k } = duel(true);
    const aim = { x: k.x - s.hero.x, y: k.y - s.hero.y };
    for (let i = 0; i < 50; i++) stepSim(s, DT, { ...NO_INPUT, attackHeld: true, aim });
    let staggered = false;
    for (let i = 0; i < 30; i++) {
      stepSim(s, DT, { ...NO_INPUT, aim });
      if (k.mode === 'stagger') staggered = true;
    }
    expect(staggered).toBe(true);
    // Щит выбит, латника отбросило: догнать и ударить, пока не опомнился.
    let first = 0;
    for (let i = 0; i < 60 && k.mode === 'stagger' && !first; i++) {
      const hp = k.hp;
      const dx = k.x - s.hero.x;
      const dy = k.y - s.hero.y;
      const far = Math.hypot(dx, dy) > 1.4;
      stepSim(s, DT, {
        ...NO_INPUT,
        mx: far ? dx : 0,
        my: far ? dy : 0,
        attack: !far && i % 12 === 0,
        aim: { x: dx, y: dy },
      });
      if (k.hp < hp) first = hp - k.hp;
    }
    expect(first).toBeGreaterThan(s.stats.dmg * 0.6);
  });
});

// ---------------------------------------------------------------------------
// Каменный идол: заповеди, взор, бот.
// ---------------------------------------------------------------------------

/** Начать бой: герой на ковре у трона, стражи убраны (если надо). */
function fight(seed: number, tier = 8, plus = 0, meat = 0): Sim {
  const s = sim(tier, plus, 31.5, bossObj.y + 0.5, seed, meat);
  step(s, 2);
  expect(s.boss!.state).toBe('fight');
  return s;
}

const idolOf = (s: Sim) => s.mobs.find((m) => m.kind === 'f4_idol')!;

describe('этаж 4: скрижаль и взор идола', () => {
  it('ПОКЛОНИСЬ: замер — лик открыт; шевельнулся — кара и оглушение', () => {
    for (const obey of [true, false]) {
      const s = fight(11);
      s.mobs = s.mobs.filter((m) => m.kind === 'f4_idol');
      s.hero.x = 31.5;
      s.hero.y = 14.5;
      const d = s.boss!.data;
      d.st = ST.rest;
      d.stT = 99;
      d.lastWasRule = 0;
      d.next = RULES.bow;
      step(s, 1);
      expect(d.st).toBe(ST.rule);
      expect(d.rule).toBe(RULES.bow);
      s.hero.inv = 0;
      let hurt = 0;
      for (let i = 0; i < 60 * 4.5; i++) {
        const move = !obey && d.judging ? { mx: 1, my: 0 } : {};
        stepSim(s, DT, { ...NO_INPUT, ...move });
        for (const e of s.events) if (e.t === 'hurt') hurt += 1;
        if (d.st !== ST.rule) break;
      }
      if (obey) {
        expect(d.st).toBe(ST.open);
        expect(hurt).toBe(0);
        expect(idolOf(s).data.ghost).toBe(0);
      } else {
        expect(d.st).toBe(ST.wrath);
        expect(hurt).toBe(1);
        expect(s.hero.status.stun).toBeTruthy();
      }
    }
  });

  it('ВОСХВАЛИ: отвернулся от идола в окно проверки — кара', () => {
    const s = fight(12);
    s.mobs = s.mobs.filter((m) => m.kind === 'f4_idol');
    s.hero.y = 16.5;
    const d = s.boss!.data;
    Object.assign(d, { st: ST.rest, stT: 99, lastWasRule: 0, next: RULES.praise });
    step(s, 1);
    expect(d.rule).toBe(RULES.praise);
    s.hero.inv = 0;
    look(s, Math.PI / 2);
    for (let i = 0; i < 60 * 4.5 && d.st === ST.rule; i++) stepSim(s, DT, NO_INPUT);
    expect(d.st).toBe(ST.wrath);
  });

  it('светлые плиты взора действительно безопасны, а мимо них — больно', () => {
    for (const onPlate of [true, false]) {
      const s = fight(13);
      s.mobs = s.mobs.filter((m) => m.kind === 'f4_idol');
      s.hero.x = 31.5;
      s.hero.y = 20.5;
      const d = s.boss!.data;
      Object.assign(d, { st: ST.rest, stT: 99, lastWasRule: 1 });
      step(s, 1);
      expect(d.st).toBe(ST.gaze);
      const plates = s.zones.filter((z) => z.art === 'f4_plate');
      expect(plates.length).toBeGreaterThanOrEqual(3);
      const near = plates.sort(
        (a, b) =>
          Math.hypot(a.x - s.hero.x, a.y - s.hero.y) - Math.hypot(b.x - s.hero.x, b.y - s.hero.y),
      )[0];
      if (onPlate) {
        s.hero.x = near.x;
        s.hero.y = near.y;
      }
      s.hero.inv = 0;
      let hurt = 0;
      for (let i = 0; i < 60 * 4 && d.st === ST.gaze; i++) {
        stepSim(s, DT, NO_INPUT);
        for (const e of s.events) if (e.t === 'hurt') hurt += 1;
      }
      expect(d.st).toBe(ST.spent);
      expect(hurt).toBe(onPlate ? 0 : 1);
    }
  });

  it('вне окна идол — камень: крохи урона; в окне — полный удар; трещины добавляют', () => {
    const s = fight(14);
    s.mobs = s.mobs.filter((m) => m.kind === 'f4_idol');
    const idol = idolOf(s);
    s.hero.x = seat.x + 0.5;
    s.hero.y = seat.y + 2.1;
    s.hero.inv = 999;
    const d = s.boss!.data;
    const swing = () => {
      const hp = idol.hp;
      for (let i = 0; i < 30; i++)
        stepSim(s, DT, { ...NO_INPUT, attack: i === 0, aim: { x: 0, y: -1 } });
      return hp - idol.hp;
    };
    Object.assign(d, { st: ST.rest, stT: -99 });
    const stone = swing();
    Object.assign(d, { st: ST.open, stT: 0 });
    step(s, 2);
    const open = swing();
    expect(stone).toBeGreaterThan(0);
    expect(stone).toBeLessThan(open * 0.35);
    expect(idolChip(3)).toBeGreaterThan(idolChip(0));
  });
});

describe('этаж 4: стражи идола', () => {
  it('разбитый страж собирается на своём постаменте, а трещина от него — одна', () => {
    const s = fight(15);
    const d = s.boss!.data;
    Object.assign(d, { st: ST.rest, stT: -1e9 });
    s.hero.inv = 1e9;
    const woke = () =>
      s.mobs.filter((m) => m.kind === 'f4_statue' && m.mode !== 'dormant' && m.mode !== 'dying');
    step(s, 70);
    const first = woke()[0];
    expect(first).toBeTruthy();
    const ped = first.data.ped;
    const kill = (m: Mob) => {
      m.hp = 1;
      for (let i = 0; i < 90 && m.mode !== 'dying'; i++) {
        s.hero.x = m.x;
        s.hero.y = m.y + 1;
        stepSim(s, DT, { ...NO_INPUT, attack: i % 15 === 0, aim: { x: 0, y: -1 } });
      }
      expect(m.mode).toBe('dying');
    };
    kill(first);
    expect(d.broken).toBe(1);
    // Груда лежит, пока не выйдет срок, — потом страж встаёт там же.
    step(s, 60 * (REFORM[0] - 2));
    expect(woke().some((m) => m.data.ped === ped)).toBe(false);
    expect(s.zones.some((z) => z.art === 'f4_reform')).toBe(true);
    step(s, 60 * 3);
    const again = woke().find((m) => m.data.ped === ped);
    expect(again, 'страж собрался').toBeTruthy();
    expect(again!.xp).toBe(0);
    kill(again!);
    expect(d.broken).toBe(1);
  });
});

/** Живой игрок против идола. */
function idolBot(s: Sim, st: { lastAtk: number; lastLook: number }): SimInput {
  const h = s.hero;
  const b = s.boss;
  const inp: SimInput = { ...NO_INPUT };
  if (!b || b.state !== 'fight') return inp;
  const d = b.data;
  const idol = s.mobs.find((m) => m.kind === 'f4_idol' && m.mode !== 'dying');
  const sx = seat.x + 0.5;
  const sy = seat.y + 0.5;
  const toward = (x: number, y: number, k = 1) => {
    const dx = x - h.x;
    const dy = y - h.y;
    const l = Math.hypot(dx, dy) || 1;
    inp.mx = (dx / l) * k;
    inp.my = (dy / l) * k;
    return l;
  };
  const attackAt = (x: number, y: number, gap = 0.16) => {
    if (s.time - st.lastAtk < gap) return;
    inp.attack = true;
    inp.aim = { x: x - h.x, y: y - h.y };
    st.lastAtk = s.time;
  };
  // Еда — когда здоровья мало и не заповедь «замри».
  if (h.hp < s.stats.maxHp * 0.38 && h.mode === 'free' && (s.sack.meat.f4_ration ?? 0) > 0) {
    if (!(d.st === ST.rule && d.rule === RULES.bow)) inp.eat = true;
  }
  const statues = s.mobs.filter(
    (m) => m.kind === 'f4_statue' && m.mode !== 'dying' && m.mode !== 'dormant',
  );
  const near = statues
    .map((m) => ({ m, d: Math.hypot(m.x - h.x, m.y - h.y) }))
    .sort((a, b) => a.d - b.d)[0];
  // 1. Взор: к ближней светлой плите.
  if (d.st === ST.gaze) {
    const plates = s.zones.filter((z) => z.art === 'f4_plate');
    const p = plates.sort(
      (a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y),
    )[0];
    if (p && Math.hypot(p.x - h.x, p.y - h.y) > 0.2) {
      const l = toward(p.x, p.y);
      if (l > 3.5 && h.dashCd <= 0) inp.dash = true;
    }
    return inp;
  }
  // 2. Удар рукой: из метки — прочь.
  for (const k of s.strikes)
    if (k.art === 'f4_slam' && Math.hypot(h.x - k.x, h.y - k.y) < k.r + 0.6) {
      toward(h.x + (h.x - k.x), h.y + (h.y - k.y) + 1);
      return inp;
    }
  // 3. Заповедь.
  if (d.st === ST.rule) {
    if (d.rule === RULES.bow) {
      // Замри; подкравшегося стража — ударом в его сторону (шаг от удара мал).
      if (near && near.d < 1.9 && s.time - st.lastAtk > 0.6) attackAt(near.m.x, near.m.y, 0.6);
      return inp;
    }
    if (d.rule === RULES.praise) {
      const a = Math.atan2(sy - h.y, sx - h.x);
      if (Math.abs(Math.atan2(Math.sin(a - h.face), Math.cos(a - h.face))) > 0.3) {
        inp.mx = Math.cos(a) * 0.13;
        inp.my = Math.sin(a) * 0.13;
      }
      return inp;
    }
    // Опусти меч: не бить, отходить от стража лицом к нему.
    if (near && near.d < 3) {
      const a = Math.atan2(near.m.y - h.y, near.m.x - h.x);
      inp.mx = Math.cos(a) * 0.13;
      inp.my = Math.sin(a) * 0.13;
    }
    return inp;
  }
  const window = !!idol && (d.st === ST.open || d.st === ST.spent);
  // 4. Страж рядом — повернуться и бить (смотришь — он камень). В окне идола
  // — только тот, кто уже замахнулся за спиной: взглянуть и дальше бить идола.
  const threat = near && (near.m.mode === 'wind' ? near.d < 1.8 : near.d < 1.0);
  if (near && (window ? threat : near.d < 2.2)) {
    attackAt(near.m.x, near.m.y);
    return inp;
  }
  // 5. Окно — к трону и бить идола.
  const front = { x: sx, y: sy + 1.9 };
  if (window) {
    if (Math.hypot(front.x - h.x, front.y - h.y) > 0.5) toward(front.x, front.y);
    attackAt(sx, sy);
    return inp;
  }
  // 6. Ждать у трона, лицом к стражам.
  const wait = { x: sx, y: sy + 3.2 };
  if (Math.hypot(wait.x - h.x, wait.y - h.y) > 0.6) toward(wait.x, wait.y);
  else if (near && s.time - st.lastLook > 0.5) {
    const a = Math.atan2(near.m.y - h.y, near.m.x - h.x);
    inp.mx = Math.cos(a) * 0.13;
    inp.my = Math.sin(a) * 0.13;
    st.lastLook = s.time;
  }
  if (near && near.d < SWORD.reach + near.m.r) attackAt(near.m.x, near.m.y);
  return inp;
}

function runBoss(seed: number, tier: number, plus: number, meat: number, limit = 360) {
  const s = sim(tier, plus, 31.5, gate.y - 1.5, seed, meat);
  const st = { lastAtk: -9, lastLook: -9 };
  let won = -1;
  let wraths = 0;
  let broken = 0;
  let minHp = 1;
  for (let t = 0; t < limit * 60; t++) {
    stepSim(s, DT, idolBot(s, st));
    minHp = Math.min(minHp, s.hero.hp / s.stats.maxHp);
    if (process.env.F4PH && t % 600 === 0) {
      const idol = s.mobs.find((m) => m.kind === 'f4_idol');
      console.log(
        s.time.toFixed(0),
        'ph',
        s.boss?.phase,
        'idol',
        idol ? (idol.hp / idol.maxHp).toFixed(2) : '-',
        'hp',
        (s.hero.hp / s.stats.maxHp).toFixed(2),
        'стражей',
        s.mobs.filter((m) => m.kind === 'f4_statue' && m.mode !== 'dormant' && m.mode !== 'dying')
          .length,
      );
    }
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'f4_wrath') wraths += 1;
      if (e.t === 'boss' && e.what === 'f4_crack') broken += 1;
    }
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  const ate = meat - (s.sack.meat.f4_ration ?? 0);
  return { won, dead: s.hero.mode === 'dead', t: s.time, wraths, broken, minHp, ate, s };
}

describe('этаж 4: бой с идолом', () => {
  // Подбор: F4TUNE=1 npx vitest run src/lib/dungeon-floors/f4.test.ts -t tune
  // (F4PH=1 — ход одного боя по фазам). На момент подбора: Сполох +2 с
  // тремя пайками — 6 побед из 6 за 2,8–4,4 мин; Сполох +0 с пайками — 3 из 6;
  // Астрофиллит +0 — 0 из 6 (бот съедает все пайки и гибнет).
  it('бот на Сполохе +2 с тремя пайками побеждает идола за 1–5 минут', () => {
    const res = [31, 32, 33, 34].map((seed) => runBoss(seed, 8, 2, 3));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(3);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(60);
      expect(r.won).toBeLessThan(300);
    }
    // Бой не прогулка: стражи и взор до героя достают.
    expect(Math.min(...res.map((r) => r.minHp))).toBeLessThan(0.8);
  });

  it('на слабом снаряжении идол сильнее', () => {
    const res = [41, 42, 43].map((seed) => runBoss(seed, 7, 0, 3, 300));
    expect(res.filter((r) => r.won > 0).length).toBe(0);
    expect(res.filter((r) => r.dead).length).toBeGreaterThanOrEqual(2);
  });

  it('после победы из зала выходят через ворота, и ворота за спиной закрываются', () => {
    const s = sim(8, 0, 31.5, 30.5, 1);
    step(s, 2);
    s.boss!.state = 'won';
    s.mobs = [];
    const goal = { x: gate.x + 0.5, y: gate.y + 4.5 };
    for (let t = 0; t < 60 * 20; t++) {
      const h = s.hero;
      const dx = goal.x - h.x;
      const dy = goal.y - h.y;
      const l = Math.hypot(dx, dy);
      if (l < 0.4) break;
      stepSim(s, DT, { ...NO_INPUT, mx: dx / l, my: dy / l });
      s.mobs = [];
    }
    expect(Math.hypot(goal.x - s.hero.x, goal.y - s.hero.y)).toBeLessThan(0.6);
    expect(s.tiles[gate.y * W + gate.x]).toBe(Tile.Gate);
    expect(s.boss!.state).toBe('rest');
  });
});

// ---------------------------------------------------------------------------
// Никто не застревает в стенах.
// ---------------------------------------------------------------------------

describe('этаж 4: монстры не застревают', () => {
  it('минута боя в крипте и святилище — ни один моб не внутри стены', () => {
    const kinds = ['f4_skel', 'f4_knight', 'f4_necro', 'f4_sentry', 'f4_skel', 'f4_knight'];
    for (const [area, x, ly] of [
      ['f4crypt', 31.5, 27.5],
      ['f4crypt', 55.5, 47.5],
      ['f4sanct', 31.5, 80.5],
    ] as [string, number, number][]) {
      const [hx, hy] = at(area, x, ly);
      const s = sim(9, 5, hx, hy, 17);
      s.hero.inv = 1e9;
      kinds.forEach((k, i) => {
        const a = (i / kinds.length) * Math.PI * 2;
        let mx = hx + Math.cos(a) * 3;
        let my = hy + Math.sin(a) * 3;
        if (!walkableTile(s.tiles[Math.floor(my) * W + Math.floor(mx)])) {
          mx = hx;
          my = hy;
        }
        spawnMob(s, k, mx, my, { mode: 'chase' });
      });
      let bad = 0;
      for (let t = 0; t < 60 * 60; t++) {
        const m = s.mobs[t % Math.max(1, s.mobs.length)];
        // Бродим кругами, отбиваясь: мобы бегут за героем по залу.
        const ang = s.time * 0.6;
        stepSim(s, DT, {
          ...NO_INPUT,
          mx: Math.cos(ang),
          my: Math.sin(ang),
          attack: t % 25 === 0,
          aim: m ? { x: m.x - s.hero.x, y: m.y - s.hero.y } : null,
        });
        for (const mm of s.mobs) {
          if (mm.mode === 'dying' || mm.mode === 'emerge' || mm.t < 0) continue;
          const tile = s.tiles[Math.floor(mm.y) * W + Math.floor(mm.x)];
          if (!walkableTile(tile) && tile !== Tile.Gate) bad += 1;
        }
      }
      expect(bad, `${area}`).toBe(0);
    }
  });

  it('данные этажа: у каждого монстра свой ИИ и рисунок, босс — часть боя', () => {
    for (const id of ['f4_skel', 'f4_bones', 'f4_knight', 'f4_necro', 'f4_sentry']) {
      expect(MOBS[id], id).toBeTruthy();
      expect(MOBS[id].art.kind).toBe('paint');
    }
    expect(MOBS.f4_idol.boss).toBe(true);
    expect(MOBS.f4_statue.boss).toBe(true);
    expect(liftOf(world, 'f4crypt')).not.toBeNull();
  });
});

describe.skipIf(!process.env.F4TUNE)('tune', () => {
  it('tune', () => {
    const all: [number, number, number][] = [
      [8, 0, 0],
      [8, 0, 3],
      [8, 2, 3],
      [7, 5, 3],
      [7, 0, 3],
      [9, 0, 0],
    ];
    const cfg = process.env.F4PH ? [all[2]] : all;
    for (const [tier, plus, meat] of cfg) {
      const seeds = process.env.F4PH ? [51] : [51, 52, 53, 54, 55, 56];
      const res = seeds.map((seed) => runBoss(seed, tier, plus, meat, 400));
      const tag = (r: (typeof res)[number]) =>
        r.won > 0 ? `W${r.won.toFixed(0)}` : r.dead ? `D${r.t.toFixed(0)}` : 'T';
      console.log(
        `T${tier}+${plus} еда ${meat}:`,
        res.map(tag).join(' '),
        '| мин',
        res.map((r) => r.minHp.toFixed(2)).join(','),
        '| съел',
        res.map((r) => r.ate).join(','),
        '| кара',
        res.map((r) => r.wraths).join(','),
      );
    }
  });
});
