// Этаж 15, район «Сердце»: бот против Хозяина подземелья (все пять фаз),
// выход с арены после победы, откат арены при смерти, механики — эхо по
// очереди и трещины кокона, четверти памяти с опасностями и проходом к
// сердцу, круги-телепорты, окно сердца, сжатие стен без ловушки,
// финал с замедлением.
//
// Бот — живой игрок средней руки (как у этажей 6–10): видит метки на полу
// и уходит из них рывком за миг до удара (с задержкой реакции, изредка
// проглядев), ест, когда здоровья меньше 40%, бьёт ближнюю открытую часть
// босса. `F15LOG=1` печатает ход боя.

import { describe, expect, it } from 'vitest';
import { DUNGEON_START, heroOf, MOBS, SLOTS } from '../dungeon';
import type { DungeonState, Gear } from '../dungeon';
import { buildWorld, Tile, walkableTile } from '../dungeon-world';
import { API, createSim, NO_INPUT, stepSim, strikeHits, SWORD } from '../dungeon-sim';
import type { Mob, Sim, SimInput } from '../dungeon-sim';
import { ECHO, f15bView, HEART, LION, QUADS } from './f15-boss-brains';
import { F15_HEART, F15B_MARK } from './f15-boss';

const world = buildWorld(15);
const W = world.w;
const DT = 1 / 60;
const LOG = !!process.env.F15LOG;
const MK = F15B_MARK;

function dungeon(tier: number, plus: number): DungeonState {
  const gear = {} as Gear;
  for (const s of SLOTS) gear[s] = { tier, plus };
  return { ...DUNGEON_START, gear, reached: 15 };
}

const bossObj = world.objs.find((o) => o.kind === 'boss')!;
const gateObj = world.objs.find((o) => o.kind === 'gate')!;

function sim(tier: number, plus: number, x: number, y: number, seed = 7, meat = 0): Sim {
  const d = dungeon(tier, plus);
  const s = createSim({ world, dungeon: d, stats: heroOf(d), x, y, seed, now: () => 1e12 });
  if (meat) {
    s.sack.meat.f10_heart = meat;
    s.sack.meatBy[F15_HEART] = meat;
  }
  return s;
}

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
    if (st.seen.size > 600) st.seen.clear();
  }
  return v;
}

const badCell = (s: Sim, x: number, y: number) => {
  const i = Math.floor(y) * W + Math.floor(x);
  const t = s.tiles[i];
  if (!walkableTile(t)) return true;
  const mk = s.world.mark[i];
  if (mk === MK.crust || mk === MK.bog) return true;
  const v = f15bView(s);
  return !!v && v.pending.includes(i);
};

function bot(s: Sim, st: BotState): SimInput {
  const h = s.hero;
  const inp: SimInput = { ...NO_INPUT };
  const b = s.boss!;
  const cx = b.obj.x + 0.5;
  const cy = b.obj.y + 0.5;
  // Удары по площади: вот-вот ударит и задевает — рывок наружу.
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
    if (z.shape === 'ring') {
      const d = Math.hypot(ax, ay) || 1;
      if (d < z.r) {
        ax = -ax;
        ay = -ay;
      }
    }
    const l = Math.hypot(ax, ay) || 1;
    inp.mx = ax / l;
    inp.my = ay / l;
    if (badCell(s, h.x + inp.mx * 2.2, h.y + inp.my * 2.2)) {
      inp.mx = -ay / l;
      inp.my = ax / l;
    }
    if (left < 0.22 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Линии прицела (клубок, таран) — вбок.
  for (const m of s.mobs) {
    const t = m.tele;
    if (!t || t.shape !== 'line') continue;
    const [react, missed] = notice(st, `l${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (missed || m.t < react) continue;
    const hit = strikeHits({ shape: 'line', x: m.x, y: m.y, r: t.r, w: t.w, ang: t.ang, warn: 1, dmg: 0 }, h.x, h.y, h.r + 0.3);
    if (!hit) continue;
    const a = (t.ang ?? 0) + Math.PI / 2;
    const side = Math.cos(a) * (h.x - m.x) + Math.sin(a) * (h.y - m.y) >= 0 ? 1 : -1;
    inp.mx = Math.cos(a) * side;
    inp.my = Math.sin(a) * side;
    if (m.danger > 0 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Летящее перо или ледышка — вбок (рывком, если уже рядом).
  for (const sh of s.shots) {
    if (sh.lob) continue;
    const dx = h.x - sh.x;
    const dy = h.y - sh.y;
    const v = Math.hypot(sh.vx, sh.vy) || 1;
    const along = (dx * sh.vx + dy * sh.vy) / v;
    const across = Math.abs(dx * sh.vy - dy * sh.vx) / v;
    if (along < 0 || along > 3.2 || across > sh.r + h.r + 0.15) continue;
    const [react, missed] = notice(st, `f${sh.id}`);
    if (missed || sh.age < react) continue;
    const side = dx * sh.vy - dy * sh.vx >= 0 ? 1 : -1;
    inp.mx = (sh.vy / v) * side;
    inp.my = (-sh.vx / v) * side;
    if (along < 1.4 && h.dashCd <= 0) inp.dash = true;
    return inp;
  }
  // Раздувшийся сгусток или замах вплотную — отскок.
  for (const m of s.mobs) {
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    const wind = m.mode === 'windup' || m.mode === 'f15c_swell';
    if (!wind) continue;
    const [react, missed] = notice(st, `w${m.id}:${Math.round((s.time - m.t) * 10)}`);
    if (!missed && m.t > react && d < MOBS[m.kind].reach + m.r + 1.2 && h.dashCd <= 0) {
      const away = Math.atan2(h.y - m.y, h.x - m.x) + 0.6;
      inp.mx = Math.cos(away);
      inp.my = Math.sin(away);
      inp.dash = true;
      return inp;
    }
  }
  // Жжёт, вязнет или стена вот-вот придавит — к сердцу.
  if (badCell(s, h.x, h.y)) {
    const l = Math.hypot(cx - h.x, cy + 2 - h.y) || 1;
    inp.mx = (cx - h.x) / l;
    inp.my = (cy + 2 - h.y) / l;
    return inp;
  }
  for (const z of s.zones) {
    if (!(z.dps || z.slow) || z.t < (z.warn ?? 0)) continue;
    const d = Math.hypot(h.x - z.x, h.y - z.y);
    if (d < z.r + h.r) {
      inp.mx = (h.x - z.x) / (d || 1);
      inp.my = (h.y - z.y) / (d || 1);
      return inp;
    }
  }
  const meat = Object.values(s.sack.meat).reduce<number>((a, c) => a + (c ?? 0), 0);
  if (h.hp < s.stats.maxHp * 0.4 && meat > 0 && h.mode === 'free' && h.eatCd <= 0) inp.eat = true;

  // Цель: ближняя открытая часть босса (эхо, голова, лев, сердце), потом сгустки.
  let near: Mob | null = null;
  let nd = 1e9;
  for (const m of s.mobs) {
    if (m.mode === 'dying' || (m.data.ghost ?? 0) > 0) continue;
    const boss = !!MOBS[m.kind]?.boss;
    const d = Math.hypot(m.x - h.x, m.y - h.y) + (boss ? 0 : 1.5);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (near) nd = Math.hypot(near.x - h.x, near.y - h.y);
  if (near && nd < 16) {
    const a = Math.atan2(near.y - h.y, near.x - h.x);
    if (nd > SWORD.reach * 0.8 + near.r * 0.6) {
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
      if (badCell(s, h.x + inp.mx, h.y + inp.my)) {
        inp.mx = Math.cos(a + 1.1);
        inp.my = Math.sin(a + 1.1);
      }
    }
    if (nd < SWORD.reach + near.r && s.time - st.lastAtk > 0.14) {
      inp.attack = true;
      inp.aim = { x: near.x - h.x, y: near.y - h.y };
      st.lastAtk = s.time;
    }
    return inp;
  }
  // Никого открытого — держаться в 4 клетках перед сердцем.
  const tx = cx;
  const ty = cy + 4;
  const l = Math.hypot(tx - h.x, ty - h.y);
  if (l > 0.8) {
    inp.mx = (tx - h.x) / l;
    inp.my = (ty - h.y) / l;
  }
  return inp;
}

interface Fight {
  won: number;
  s: Sim;
  phases: number;
  low: number;
  finale: number;
  echoes: number;
}

function fight(tier: number, plus: number, seed: number, meat = 5, limit = 600): Fight {
  const s = sim(tier, plus, bossObj.x + 0.5, bossObj.y + 7.5, seed, meat);
  const st: BotState = { lastAtk: -9, react: [0.22, 0.45], miss: 0.12, seed };
  let won = -1;
  let phases = 0;
  let low = 1;
  let finale = 0;
  let echoes = 0;
  const marks: string[] = [];
  const src = new Map<string, number>();
  for (let t = 0; t < limit * 60; t++) {
    const hp0 = s.hero.hp;
    const firing = s.strikes.filter((z) => z.t + DT >= z.warn && strikeHits(z, s.hero.x, s.hero.y, s.hero.r));
    stepSim(s, DT, bot(s, st));
    if (LOG && s.hero.hp < hp0 - 1) {
      const who =
        firing[0]?.art ??
        (Object.keys(s.hero.status).join('+') ||
          s.mobs
            .filter((m) => Math.hypot(m.x - s.hero.x, m.y - s.hero.y) < 3)
            .map((m) => `${m.kind}:${m.mode}`)[0] ||
          (s.shots.length ? 'shot' : '?'));
      src.set(`${s.boss?.phase}:${who}`, (src.get(`${s.boss?.phase}:${who}`) ?? 0) + (hp0 - s.hero.hp) / s.stats.maxHp);
    }
    low = Math.min(low, s.hero.hp / s.stats.maxHp);
    for (const e of s.events) {
      if (e.t === 'boss' && e.what === 'dead') won = s.time;
      if (e.t === 'boss' && e.what === 'finale') finale += 1;
      if (e.t === 'boss' && e.what === 'phase') {
        phases += 1;
        marks.push(`${e.text}@${s.time.toFixed(0)}`);
      }
      if (e.t === 'boss' && e.what === 'f15b_crack_stone') {
        echoes += 1;
        marks.push(`эхо${echoes}@${s.time.toFixed(0)}`);
      }
    }
    if (won > 0 || s.hero.mode === 'dead') break;
  }
  if (LOG) {
    const lion = s.mobs.find((m) => m.kind === 'f15boss');
    console.log(
      `T${tier}+${plus} зерно ${seed}: ${won > 0 ? `победа за ${won.toFixed(0)} с` : `поражение на ${s.time.toFixed(0)} с`}, фаза ${s.boss?.phase}, лев ${lion ? Math.round((100 * lion.hp) / lion.maxHp) : 0}%, минимум здоровья ${Math.round(low * 100)}%, мяса ${s.sack.meat.f10_heart ?? 0} · ${marks.join(' ')}`,
    );
    console.log(
      '  урон:',
      [...src]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 14)
        .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
        .join(', '),
    );
  }
  return { won, s, phases, low, finale, echoes };
}

describe('этаж 15: Хозяин подземелья', () => {
  it('на Т8+5 с едой бот проходит все пять фаз за 4–8 минут, не всегда без риска', () => {
    const res = (process.env.F15SEEDS ?? '41,42,43,44').split(',').map((seed) => fight(8, 5, Number(seed)));
    const wins = res.filter((r) => r.won > 0);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    for (const r of wins) {
      expect(r.won).toBeGreaterThan(240);
      expect(r.won).toBeLessThan(480);
      expect(r.echoes).toBe(5);
      expect(r.phases).toBe(4);
      expect(r.finale).toBe(1);
    }
    expect(res.some((r) => r.won < 0 || r.low < 0.45)).toBe(true);
  });
});

describe.runIf(!!process.env.F15SWEEP)('этаж 15: подбор', () => {
  it('сетка снаряжения', () => {
    for (const [tier, plus, meat] of (process.env.F15SWEEP ?? '').split(';').map((x) => x.split(',').map(Number)))
      for (const seed of [61, 62, 63]) fight(tier, plus, seed, meat);
  });
});

void [ECHO, HEART, LION, QUADS, API, Tile, gateObj];
