// Этаж 4 «Двойная крипта» — ИИ монстров, правило этажа и сценарий
// Каменного идола. Движок не импортируется значениями (круг модулей): всё,
// что нужно, приходит в `api`.
//
// Главное правило этажа — ВЗГЛЯД. Статуи (страж-изваяние в колоннаде и
// стражи идола на арене) движутся, только пока герой на них НЕ смотрит:
// угол между взглядом героя (`hero.face`) и направлением на статую больше
// `LOOK`. Посмотрел — застыла, даже посреди замаха: полоска замаха стоит,
// пока снова не отвернёшься. Каждый раз, застывая, статуя встаёт в новую
// позу — повернулся, а она уже ближе и в другой стойке.
//
// Второе — ЩИТ. Латник закрыт спереди: удар в лоб — искры и крохи урона
// (`parry`), со спины и сбоку — полный. Тяжёлый удар в щит выбивает его
// (оглушение, открыт). У движка нет крючка «моба ударили», поэтому щит
// сделан через недосягаемость (`data.ghost`): пока герой спереди, удары
// движка латника не берут, а свой удар по щиту считает ИИ по фазе клинка
// героя (`bladeNow`). То же у идола вне окна уязвимости.
//
// Третье — КОСТИ. Убитый костяк рассыпается кучкой (`f4_bones`): не добил
// её за `BONES_RISE` — кости сползаются, и он встаёт с 60% здоровья.
// Некромант поднимает кучки разом и ставит новые из-под плит.
//
// Босс — Каменный идол. Сидит на троне и не ходит. Бой — по СКРИЖАЛИ:
// заповедь на табло (ПОКЛОНИСЬ — замри; ВОСХВАЛИ — смотри на идола;
// ОПУСТИ МЕЧ — не бей), выполнил — «лик открыт», идол уязвим; нарушил —
// КАРА. Потом ВЗОР: зал заливают лучи из глаз, волнами с севера на юг,
// целы только светлые плиты. После взора глаза гаснут — снова окно. По
// краям зала стражи: 2, с трети здоровья — 4, с двух третей — 6. Разбитый
// страж — трещина в идоле: вне окна он получает больше.

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi } from '../dungeon-ai';
import type { BossFight, Mob, Sim } from '../dungeon-sim';
import type { World, WorldObj } from '../dungeon-world';
import { BONES_RISE, F4_MARK } from './f4';

const TAU = Math.PI * 2;

function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** Повернуть взгляд моба к углу не быстрее `step` радиан. */
function turnToward(m: Mob, target: number, step: number): void {
  const d = angDiff(target, m.face);
  m.face += Math.max(-step, Math.min(step, d));
}

/** Разгон без поворота взгляда (у латника лицо поворачивается медленно, само). */
function push(m: Mob, dx: number, dy: number, speed: number, dt: number): void {
  const k = Math.min(1, dt * 10);
  m.vx += (dx * speed - m.vx) * k;
  m.vy += (dy * speed - m.vy) * k;
}

// ---------------------------------------------------------------------------
// Общее вью-состояние для рисовальщиков (`f4-art.ts`): предметам этажа не
// видно симуляции, а трон и постаменты обязаны знать, идёт ли бой.
// ---------------------------------------------------------------------------

export type F4Rule = '' | 'bow' | 'praise' | 'sheathe' | 'gaze';

export const F4_VIEW = {
  /** Идол: стоит статуей до боя, в бою его рисует моб, после победы — разбит. */
  idol: 'intact' as 'intact' | 'fight' | 'broken',
  /** Заповедь, что горит на скрижали, и сколько её прошло (0…1). */
  rule: '' as F4Rule,
  ruleK: 0,
  /** Окно проверки заповеди идёт. */
  judging: false,
};

// ---------------------------------------------------------------------------
// Взгляд героя.
// ---------------------------------------------------------------------------

/** Половина угла взгляда: статуя «видна», если она в этом конусе. */
export const LOOK = (70 * Math.PI) / 180;
/** Дальше этого статуе всё равно, куда смотрят: застывает, как ждёт. */
const LOOK_FAR = 16;

/** Смотрит ли герой на точку. */
export function seen(sim: Sim, x: number, y: number): boolean {
  const h = sim.hero;
  if (h.mode === 'dying' || h.mode === 'dead') return false;
  const dx = x - h.x;
  const dy = y - h.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return true;
  return Math.abs(angDiff(Math.atan2(dy, dx), h.face)) < LOOK;
}

// ---------------------------------------------------------------------------
// Клинок героя: в какой миг он задевает. Копия чисел `SWORD` движка — у ИИ
// нет крючка «моба ударили» (нужен движку: `Brain.onHit`, см. отчёт).
// ---------------------------------------------------------------------------

interface Blade {
  reach: number;
  arc: number;
  aim: number;
  mult: number;
  heavy: boolean;
  /** Какой это взмах: один взмах — один отбой щитом. */
  key: number;
}

const ARC = (110 * Math.PI) / 180;
const STEPS = [
  { from: 0.05, to: 0.12, arc: 1, mult: 1 },
  { from: 0.05, to: 0.12, arc: 1, mult: 1.05 },
  { from: 0.1, to: 0.18, arc: 1.35, mult: 1.6 },
];

export function bladeNow(sim: Sim): Blade | null {
  const h = sim.hero;
  const t = h.t * sim.stats.haste;
  const start = sim.time - h.t;
  if (h.mode === 'attack') {
    const s = STEPS[h.step];
    if (!s || t < s.from || t > s.to + 0.02) return null;
    return {
      reach: 1.35,
      arc: ARC * s.arc,
      aim: h.aim,
      mult: s.mult,
      heavy: false,
      key: start + h.step * 1000,
    };
  }
  if (h.mode === 'heavy') {
    if (t < 0.07 || t > 0.18) return null;
    return {
      reach: 1.62,
      arc: (220 * Math.PI) / 180,
      aim: h.aim,
      mult: 2.4 * (0.55 + 0.45 * h.charge),
      heavy: true,
      key: start + 5000,
    };
  }
  if (h.mode === 'skill')
    return {
      reach: 1.9,
      arc: TAU,
      aim: h.aim,
      mult: 1.5,
      heavy: false,
      key: start + 9000 + (h.t >= 0.25 ? 0.5 : 0),
    };
  return null;
}

function covers(sim: Sim, b: Blade, m: Mob): boolean {
  const h = sim.hero;
  const dx = m.x - h.x;
  const dy = m.y - h.y;
  const d = Math.hypot(dx, dy);
  if (d > b.reach + m.r) return false;
  const off = Math.abs(angDiff(Math.atan2(dy, dx), b.aim));
  const slack = d > 0.01 ? Math.atan(m.r / d) : Math.PI;
  return off <= b.arc / 2 + slack;
}

/**
 * Удар пришёлся в щит или в камень: искры, крохи урона (`k` — доля), отдача
 * герою. Убить так нельзя — нужно зайти сбоку или дождаться окна.
 */
function parry(sim: Sim, m: Mob, b: Blade, k: number, boss: boolean): number {
  const h = sim.hero;
  if (Math.abs((m.data.parry ?? -1) - b.key) < 0.01) return 0;
  m.data.parry = b.key;
  const dmg = sim.stats.dmg * b.mult * k * (0.9 + sim.rng() * 0.2);
  m.hp = Math.max(1, m.hp - dmg);
  m.flash = 0.06;
  const a = Math.atan2(h.y - m.y, h.x - m.x);
  sim.hitstop = Math.max(sim.hitstop, 0.045);
  sim.events.push({ t: 'clank', x: m.x + Math.cos(a) * m.r, y: m.y + Math.sin(a) * m.r });
  sim.events.push({
    t: 'hit',
    x: m.x,
    y: m.y,
    dmg: Math.round(dmg),
    crit: false,
    kill: false,
    boss,
  });
  h.vx += Math.cos(a) * 2.4;
  h.vy += Math.sin(a) * 2.4;
  h.skill = Math.min(1, h.skill + 0.03);
  return dmg;
}

// ---------------------------------------------------------------------------
// Костяк: ближний бой с ржавым мечом. Убит — кучка костей (`f4_bones`).
// ---------------------------------------------------------------------------

/** Сколько костяк встаёт из кучки, с. */
const RISE_T = 0.55;

registerBrain('f4_skel', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    switch (m.mode) {
      case 'rise':
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(dy, dx);
        if (m.t > RISE_T) api.setMode(m, 'chase');
        return;
      case 'chase': {
        const reach = def.reach + m.r + h.r;
        if (dist < reach && m.cd <= 0) {
          api.setMode(m, 'windup');
          m.face = Math.atan2(dy, dx);
          return;
        }
        // Обходят с флангов, как стая, но без зигзага: мертвецы ходят прямо.
        let tx = h.x;
        let ty = h.y;
        if (dist > 1.6) {
          const side = ((m.id * 2.399) % TAU) - Math.PI;
          const r = Math.min(1.2, dist * 0.3);
          tx += Math.cos(side) * r;
          ty += Math.sin(side) * r;
        }
        const [cx, cy] = api.chaseDir(sim, m, tx, ty);
        api.steer(sim, m, cx, cy, m.speed * (dist < 1.4 ? 0.6 : 1), dt);
        return;
      }
      case 'windup':
        m.vx *= 0.75;
        m.vy *= 0.75;
        if (m.t > def.windup - 0.22) m.danger = def.reach + m.r + h.r + 0.4;
        if (m.t >= def.windup) {
          m.danger = 0;
          if (dist < def.reach + m.r + h.r + 0.18) api.hurtHero(sim, m.dmg, m.x, m.y, 2.5, m.kind);
          m.vx += Math.cos(m.face) * 3;
          m.vy += Math.sin(m.face) * 3;
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      case 'recover':
        m.danger = 0;
        api.steer(sim, m, -dx / (dist || 1), -dy / (dist || 1), m.speed * 0.3, dt);
        if (m.t > 0.35) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m, _mode, api) {
    // Кучка на том же месте: пока её не разбили — она сползается обратно.
    const b = api.spawnMob(sim, 'f4_bones', m.x, m.y, { mode: 'pile', level: m.level });
    b.data.skHp = m.maxHp;
    b.data.skDmg = m.dmg;
    b.data.skSpd = m.speed;
    b.data.skR = m.r;
    b.data.skXp = m.xp;
    b.data.elite = m.elite ? 1 : 0;
    b.data.lives = (m.data.lives ?? 0) + 1;
    b.face = m.face;
    b.hx = m.hx;
    b.hy = m.hy;
    // Кости ещё сыплются: тот же взмах, что убил костяка, их не разбивает.
    b.data.ghost = 1;
    b.data.fresh = 0.3;
    api.collide(sim, b);
  },
});

/** Кучка встаёт костяком: тот же моб меняет вид (поймал взгляд — поздно). */
export function riseFromBones(sim: Sim, m: Mob, api: SimApi): void {
  const d = m.data;
  const def = api.def('f4_skel');
  m.kind = 'f4_skel';
  // Кучка, поставленная некромантом, ещё не была костяком — берёт своё.
  const hp = d.skHp ?? def.hp * Math.pow(1.8, m.level);
  m.maxHp = hp;
  m.hp = hp * 0.6;
  m.dmg = d.skDmg ?? def.dmg * Math.pow(1.7, m.level);
  m.speed = d.skSpd ?? def.speed;
  m.r = d.skR ?? def.radius;
  m.xp = (d.skXp ?? def.xp * Math.pow(1.5, m.level)) * 0.35;
  m.elite = d.elite === 1;
  m.tele = null;
  m.danger = 0;
  m.cd = 0.7;
  m.data = { lives: d.lives ?? 1 };
  api.setMode(m, 'rise');
  sim.events.push({ t: 'strike', x: m.x, y: m.y, art: 'f4_rise' });
}

registerBrain('f4_bones', {
  step(sim, m, dt, _c, api) {
    m.vx *= 0.8;
    m.vy *= 0.8;
    if (m.mode !== 'pile') api.setMode(m, 'pile');
    m.data.fresh = Math.max(0, (m.data.fresh ?? 0) - dt);
    m.data.ghost = m.data.fresh > 0 ? 1 : 0;
    // Некромант торопит кости: подгоняет вчетверо.
    const boost = (m.data.boost ?? 0) > 0;
    m.data.boost = Math.max(0, (m.data.boost ?? 0) - dt);
    m.data.k = Math.min(1, (m.data.k ?? 0) + (dt / BONES_RISE) * (boost ? 4 : 1));
    // Кольцо сжимается к моменту подъёма — видно, сколько осталось добить.
    m.tele = { shape: 'ring', r: 0.62, w: 0.06, k: m.data.k };
    if (m.data.k >= 1) riseFromBones(sim, m, api);
  },
});

// ---------------------------------------------------------------------------
// Латник склепа: щит спереди, медленный поворот, медленный выпад.
// ---------------------------------------------------------------------------

const KNIGHT = {
  /** Поворот щита, рад/с: обойти можно, обогнать — нет. */
  turn: 1.8,
  /** Половина угла, который закрывает щит. */
  front: (65 * Math.PI) / 180,
  lungeV: 8.5,
  lungeT: 0.26,
  openT: 1.15,
  staggerT: 1.3,
  /** Доля урона, что проходит сквозь щит. */
  chip: 0.12,
};

/** Закрыт ли латник щитом от героя прямо сейчас. */
export function knightGuards(sim: Sim, m: Mob): boolean {
  if (m.mode !== 'guard' && m.mode !== 'aim' && m.mode !== 'chase') return false;
  const a = Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x);
  return Math.abs(angDiff(a, m.face)) < KNIGHT.front;
}

registerBrain('f4_knight', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    const want = Math.atan2(dy, dx);
    if (m.mode === 'chase') api.setMode(m, 'guard');
    switch (m.mode) {
      case 'guard': {
        m.tele = null;
        m.danger = 0;
        turnToward(m, want, KNIGHT.turn * dt);
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        push(m, cx, cy, dist > 2 ? m.speed : m.speed * 0.25, dt);
        const reach = def.reach + m.r + h.r;
        if (
          dist < reach &&
          m.cd <= 0 &&
          Math.abs(angDiff(want, m.face)) < 0.45 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y)
        ) {
          api.setMode(m, 'aim');
          m.dir = m.face;
        }
        break;
      }
      case 'aim': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < def.windup * 0.5) turnToward(m, want, KNIGHT.turn * 0.6 * dt);
        m.dir = m.face;
        m.tele = {
          shape: 'line',
          r: KNIGHT.lungeV * KNIGHT.lungeT + m.r + 0.4,
          w: 0.32,
          ang: m.dir,
          k: Math.min(1, m.t / def.windup),
        };
        m.danger = m.t > def.windup - 0.25 ? 3 : 0;
        if (m.t >= def.windup) {
          m.tele = null;
          m.data.hit = 0;
          api.setMode(m, 'lunge');
        }
        break;
      }
      case 'lunge': {
        m.vx = Math.cos(m.dir) * KNIGHT.lungeV;
        m.vy = Math.sin(m.dir) * KNIGHT.lungeV;
        m.danger = m.r + h.r + 0.9;
        const along = (h.x - m.x) * Math.cos(m.dir) + (h.y - m.y) * Math.sin(m.dir);
        const across = Math.abs(-(h.x - m.x) * Math.sin(m.dir) + (h.y - m.y) * Math.cos(m.dir));
        if (!m.data.hit && along > -0.1 && along < m.r + h.r + 0.55 && across < m.r + h.r) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.25, m.x, m.y, 6, m.kind);
        }
        if (m.t >= KNIGHT.lungeT) {
          m.danger = 0;
          m.vx *= 0.2;
          m.vy *= 0.2;
          api.setMode(m, 'open');
          m.cd = def.rest * (0.9 + sim.rng() * 0.3);
        }
        break;
      }
      case 'open':
        // Щит опущен, копьё в полу: окно для ответа.
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > KNIGHT.openT) api.setMode(m, 'guard');
        break;
      case 'stagger':
        m.vx *= 0.85;
        m.vy *= 0.85;
        m.tele = null;
        m.danger = 0;
        if (m.t > KNIGHT.staggerT) api.setMode(m, 'guard');
        break;
      default:
        api.setMode(m, 'guard');
    }
    // Щит: пока герой спереди, удары движка латника не берут — отбой считает ИИ.
    if (knightGuards(sim, m)) {
      m.data.ghost = 1;
      const b = bladeNow(sim);
      if (b && covers(sim, b, m)) {
        if (b.heavy) {
          // Тяжёлый удар выбивает щит: оглушён и открыт со всех сторон.
          if (parry(sim, m, b, 0.5, false) > 0) {
            sim.events.push({ t: 'clank', x: m.x, y: m.y - 0.3 });
            const a = Math.atan2(m.y - h.y, m.x - h.x);
            m.kx += Math.cos(a) * 4;
            m.ky += Math.sin(a) * 4;
            api.setMode(m, 'stagger');
            m.data.ghost = 0;
          }
        } else parry(sim, m, b, KNIGHT.chip, false);
      }
    } else m.data.ghost = 0;
  },
});

// ---------------------------------------------------------------------------
// Некромант: держится сзади, могильный огонь, поднимает кости, исчезает.
// ---------------------------------------------------------------------------

const NECRO = {
  near: 3.2,
  far: 6.5,
  blinkCd: 7,
  raiseCd: 9,
  raiseT: 1.1,
  fadeT: 0.35,
};

/** Кучки костей, до которых дотягивается некромант. */
function pilesNear(sim: Sim, x: number, y: number, r: number): Mob[] {
  return sim.mobs.filter(
    (o) => o.kind === 'f4_bones' && o.mode === 'pile' && Math.hypot(o.x - x, o.y - y) < r,
  );
}

/** Куда исчезнуть: пол в 5–7 клетках от героя, достижимый по полю расстояний. */
function blinkSpot(sim: Sim, api: SimApi): [number, number] | null {
  const h = sim.hero;
  const w = sim.world.w;
  for (let i = 0; i < 16; i++) {
    const a = sim.rng() * TAU;
    const d = 5 + sim.rng() * 2;
    const x = h.x + Math.cos(a) * d;
    const y = h.y + Math.sin(a) * d;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (api.solidTile(sim, cx, cy)) continue;
    if (api.inArena(sim, x, y)) continue;
    const f = sim.flow[cy * w + cx];
    if (f < 0 || f > 12) continue;
    if (!api.lineOfSight(sim, x, y, h.x, h.y)) continue;
    return [cx + 0.5, cy + 0.5];
  }
  return null;
}

registerBrain('f4_necro', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.data.blinkCd = (m.data.blinkCd ?? 2) - dt;
    m.data.raiseCd = (m.data.raiseCd ?? 3) - dt;
    // Удар сбивает колдовство: кто бьёт некроманта, тот его и останавливает.
    const hurt = m.hp < (m.data.lastHp ?? m.hp);
    m.data.lastHp = m.hp;
    if (hurt && (m.mode === 'aim' || m.mode === 'raise')) {
      m.tele = null;
      m.danger = 0;
      api.setMode(m, 'stun');
      return;
    }
    switch (m.mode) {
      case 'chase': {
        m.data.ghost = 0;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (dist < 2.2 && m.data.blinkCd <= 0) {
          api.setMode(m, 'blink');
          m.data.blinkCd = NECRO.blinkCd;
          return;
        }
        if (see && dist < NECRO.far + 0.5 && m.cd <= 0) {
          const piles = pilesNear(sim, m.x, m.y, 7).length;
          if (m.data.raiseCd <= 0 && (piles > 0 || sim.rng() < 0.5)) {
            api.setMode(m, 'raise');
            m.data.raiseCd = NECRO.raiseCd;
            return;
          }
          api.setMode(m, 'aim');
          m.face = Math.atan2(dy, dx);
          return;
        }
        if (dist < NECRO.near && see) {
          const away = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
          api.steer(sim, m, away[0], away[1], m.speed, dt);
          m.face = Math.atan2(dy, dx);
        } else {
          const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
          api.steer(sim, m, cx, cy, dist < NECRO.far ? m.speed * 0.3 : m.speed, dt);
        }
        return;
      }
      case 'aim': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < def.windup * 0.66) m.face = Math.atan2(dy, dx);
        m.tele = { shape: 'line', r: NECRO.far + 1, w: 0.16, ang: m.face, k: m.t / def.windup };
        if (m.t >= def.windup) {
          m.tele = null;
          api.shoot(sim, m, m.face);
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      }
      case 'raise': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(dy, dx);
        m.tele = { shape: 'circle', r: 1.1, k: m.t / NECRO.raiseT };
        if (m.t >= NECRO.raiseT) {
          m.tele = null;
          const piles = pilesNear(sim, m.x, m.y, 7);
          if (piles.length) {
            // Все кучки вокруг торопятся встать.
            for (const p of piles) p.data.boost = 2;
          } else {
            // Кости из-под плит: две кучки у героя. Встанут, если не разбить.
            for (let i = 0; i < 2; i++) {
              const a = sim.rng() * TAU;
              const r = 1.6 + sim.rng() * 1.2;
              const x = h.x + Math.cos(a) * r;
              const y = h.y + Math.sin(a) * r;
              if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
              const b = api.spawnMob(sim, 'f4_bones', x, y, { mode: 'pile', level: m.level });
              b.data.k = 0.3;
              b.data.lives = 1;
              api.collide(sim, b);
              sim.events.push({ t: 'strike', x, y, art: 'f4_rise' });
            }
          }
          sim.events.push({ t: 'boss', what: 'f4_raise' });
          api.setMode(m, 'recover');
          m.cd = def.rest;
        }
        return;
      }
      case 'blink': {
        // Тает в пыль (недосягаем), появляется поодаль.
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.data.ghost = 1;
        if (m.t >= NECRO.fadeT) {
          const to = blinkSpot(sim, api);
          if (to) {
            sim.events.push({ t: 'strike', x: m.x, y: m.y, art: 'f4_blink' });
            m.x = to[0];
            m.y = to[1];
            m.vx = 0;
            m.vy = 0;
          }
          api.setMode(m, 'appear');
        }
        return;
      }
      case 'appear':
        m.data.ghost = m.t < 0.2 ? 1 : 0;
        m.face = Math.atan2(dy, dx);
        if (m.t > NECRO.fadeT) {
          m.data.ghost = 0;
          api.setMode(m, 'chase');
          m.cd = Math.min(m.cd, 0.4);
        }
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.45) api.setMode(m, 'chase');
        return;
      default:
        m.data.ghost = 0;
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Статуи: движутся, только пока на них не смотрят.
// ---------------------------------------------------------------------------

/**
 * Шаг ожившей статуи. `boss` — страж идола (ИИ ведёт все режимы сам). Режимы:
 * `still` — на неё смотрят, застыла; `creep` — не смотрят, идёт; `wind` —
 * замах (копится, только пока не смотрят); `recover` — после удара.
 */
function statueStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi, far = LOOK_FAR): void {
  const h = sim.hero;
  const { dx, dy, dist, def } = c;
  // Страж колоннады дальше `far` не гонится; страж идола идёт через весь зал.
  const look = seen(sim, m.x, m.y) || dist > far;
  const heroDown = h.mode === 'dying' || h.mode === 'dead';
  m.data.eyes = look || heroDown ? 0 : 1;
  if (m.mode === 'wind') {
    m.vx = 0;
    m.vy = 0;
    if (!look && !heroDown) m.data.wk = (m.data.wk ?? 0) + dt;
    const k = Math.min(1, (m.data.wk ?? 0) / def.windup);
    m.tele = { shape: 'cone', r: def.reach + m.r + 0.45, arc: 1.7, ang: m.face, k };
    m.danger = !look && def.windup - (m.data.wk ?? 0) < 0.25 ? def.reach + m.r + 1.2 : 0;
    if (k >= 1) {
      m.tele = null;
      m.danger = 0;
      const off = Math.abs(angDiff(Math.atan2(dy, dx), m.face));
      if (dist < def.reach + m.r + h.r + 0.25 && off < 1.0)
        api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind);
      sim.events.push({
        t: 'boom',
        x: m.x + Math.cos(m.face) * 0.6,
        y: m.y + Math.sin(m.face) * 0.6,
        r: 0,
      });
      api.setMode(m, 'recover');
      m.cd = def.rest;
    }
    return;
  }
  m.tele = null;
  m.danger = 0;
  if (m.mode === 'recover') {
    m.vx = 0;
    m.vy = 0;
    if (m.t > 0.5) api.setMode(m, look ? 'still' : 'creep');
    return;
  }
  if (look || heroDown) {
    if (m.mode !== 'still') {
      // Застыла — уже в новой позе: повернулся, а она стоит иначе.
      if (m.mode === 'creep') m.data.pose = ((m.data.pose ?? 0) + 1) % 4;
      api.setMode(m, 'still');
    }
    m.vx = 0;
    m.vy = 0;
    return;
  }
  if (m.mode !== 'creep') api.setMode(m, 'creep');
  if (dist < def.reach + m.r + h.r && m.cd <= 0) {
    api.setMode(m, 'wind');
    m.data.wk = 0;
    m.face = Math.atan2(dy, dx);
    return;
  }
  const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
  // Никакой инерции: камень не разгоняется, он просто уже там.
  m.vx = cx * m.speed;
  m.vy = cy * m.speed;
  m.face = Math.atan2(cy, cx);
}

registerBrain('f4_sentry', {
  step(sim, m, dt, c, api) {
    if (m.mode === 'chase') api.setMode(m, 'still');
    statueStep(sim, m, dt, c, api);
  },
});

registerBrain('f4_statue', {
  raw: true,
  step(sim, m, dt, c, api) {
    if (m.mode === 'dying') return;
    const b = sim.boss;
    if (m.mode === 'dormant') {
      // Стоит на постаменте статуей, пока идол не разбудит.
      m.vx = 0;
      m.vy = 0;
      m.data.eyes = 0;
      return;
    }
    if (m.mode === 'rise') {
      m.vx = 0;
      m.vy = 0;
      m.data.eyes = 1;
      if (m.t > 0.8) api.setMode(m, 'still');
      return;
    }
    // Взор идола: стражи склоняются и не шевелятся.
    if (b && b.data.st === ST.gaze) {
      m.vx = 0;
      m.vy = 0;
      m.tele = null;
      m.danger = 0;
      m.data.eyes = 0;
      if (m.mode !== 'bow') api.setMode(m, 'bow');
      return;
    }
    if (m.mode === 'bow') api.setMode(m, 'still');
    const was = m.mode; // v2.85 — только рисунок
    statueStep(sim, m, dt, c, api, Infinity);
    vfxStatue(sim, m, dt, was, api); // v2.85 — только рисунок
  },
});

// v2.85 — только рисунок: пыль и осколки стражей и идола (`f4-boss-fx.ts`).
// Зоны без урона, статусов и замедления — на бой не влияют (v2.85 — только рисунок).
/** v2.85 — только рисунок: шаги камня, пыль у застывшего, удар мечом о плиты. */
function vfxStatue(sim: Sim, m: Mob, dt: number, was: string, api: SimApi): void {
  // v2.85 — только рисунок
  const b = sim.boss; // v2.85 — только рисунок
  if (!b) return; // v2.85 — только рисунок
  const f = m.face; // v2.85 — только рисунок
  if (was === 'wind' && m.mode === 'recover') {
    // v2.85 — только рисунок: меч врезался в плиты перед стражем.
    const x = m.x + Math.cos(f) * 0.8; // v2.85 — только рисунок
    const y = m.y + Math.sin(f) * 0.8 + 0.1; // v2.85 — только рисунок
    api.vfx(sim, { x, y, r: 0.4, life: 0.9, art: 'f4_cut' }); // v2.85 — только рисунок
    sim.events.push({ t: 'shake', k: 0.12 }); // v2.85 — только рисунок
    return; // v2.85 — только рисунок
  } // v2.85 — только рисунок
  if (was === 'creep' && m.mode === 'still') {
    // v2.85 — только рисунок: застыл — с него осыпается пыль, он только что шёл.
    api.vfx(sim, { x: m.x, y: m.y, r: 0.4, life: 0.8, art: 'f4_freeze' }); // v2.85 — только рисунок
    return; // v2.85 — только рисунок
  } // v2.85 — только рисунок
  if (m.mode !== 'creep') return; // v2.85 — только рисунок
  m.data.vStep = (m.data.vStep ?? 0) + dt; // v2.85 — только рисунок
  if (m.data.vStep < 0.34 || sim.time - (b.data.vDust ?? -9) < 0.1) return; // v2.85 — только рисунок
  m.data.vStep = 0; // v2.85 — только рисунок
  b.data.vDust = sim.time; // v2.85 — только рисунок: на весь зал не чаще 10 в секунду
  const x = m.x - Math.cos(f) * 0.15; // v2.85 — только рисунок
  api.vfx(sim, { x, y: m.y + 0.05, r: 0.3, life: 0.5, art: 'f4_step' }); // v2.85 — только рисунок
} // v2.85 — только рисунок

/** v2.85 — только рисунок: скол базальта — осколки летят к герою. */
function vfxChip(sim: Sim, m: Mob, api: SimApi): void {
  // v2.85 — только рисунок
  const a = Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x); // v2.85 — только рисунок
  const x = m.x + Math.cos(a) * m.r; // v2.85 — только рисунок
  const y = m.y + Math.sin(a) * m.r; // v2.85 — только рисунок
  api.vfx(sim, { x, y, r: 0.3, life: 0.7, art: 'f4_chip', above: true }); // v2.85 — только рисунок
} // v2.85 — только рисунок

// ---------------------------------------------------------------------------
// Каменный идол.
// ---------------------------------------------------------------------------

/** Состояния сценария (`b.data.st`). */
export const ST = {
  rest: 0,
  rule: 1,
  open: 2,
  gaze: 3,
  spent: 4,
  wrath: 5,
} as const;

/** Заповеди скрижали (`b.data.rule`). */
export const RULES = {
  bow: 1,
  praise: 2,
  sheathe: 3,
} as const;

const RULE_TEXT: Record<number, [string, string]> = {
  [RULES.bow]: ['ПОКЛОНИСЬ', 'замри, пока горит скрижаль'],
  [RULES.praise]: ['ВОСХВАЛИ', 'смотри на идола, пока горит скрижаль'],
  [RULES.sheathe]: ['ОПУСТИ МЕЧ', 'не бей, пока горит скрижаль'],
};

/** Числа боя по фазам (0 — начало, 1 — с 2/3 здоровья, 2 — с 1/3). */
const PH = [
  { rest: 2.2, rule: 3.8, judge: 1.5, open: 5, warn: 2.1, spent: 3.6, statues: 2 },
  { rest: 1.8, rule: 3.4, judge: 1.4, open: 4.5, warn: 1.9, spent: 3.2, statues: 4 },
  { rest: 1.4, rule: 3.0, judge: 1.3, open: 4, warn: 1.7, spent: 3.0, statues: 6 },
];

/** «Поклонись»: на сколько клеток можно сдвинуться (толчки стражей прощены). */
const BOW_STEP = 0.8;
/** «Опусти меч»: сколько секунд доигрывается удар, начатый до заповеди. */
const SHEATHE_GRACE = 0.75;

/** Сколько идол получает вне окна: камень, и трещины от разбитых стражей. */
export function idolChip(broken: number): number {
  return Math.min(0.5, 0.15 + 0.07 * broken);
}

/**
 * Разбитый страж собирается на своём постаменте заново — идол держит зал,
 * пока жив. Секунды по фазам. Трещина по идолу от стража — одна на
 * постамент: второй раз тот же страж идола не ранит.
 */
export const REFORM = [20, 16, 14];
/** Сколько стражей держат зал собравшимися заново (разбуженных фазой — больше). */
const REFORM_CAP = [2, 3, 4];

/** Раздел арены, который знает сценарий: плиты, постаменты, трон, ряды. */
interface Arena {
  seatX: number;
  seatY: number;
  /** Плиты света 2×2: левый верхний угол. */
  plates: [number, number][];
  /** Постаменты стражей: с севера на юг (первыми просыпаются ближние к трону). */
  peds: WorldObj[];
  /** Ряды зала: y → отрезки [x0, x1] пола арены. */
  rows: Map<number, [number, number][]>;
  y0: number;
  y1: number;
}

const arenas = new WeakMap<World, Arena>();

function arenaOf(sim: Sim, b: BossFight): Arena {
  const w = sim.world;
  let a = arenas.get(w);
  if (a) return a;
  const seat = w.objs.find((o) => o.ref === 'f4_idol');
  const cells = [...b.cells];
  const rows = new Map<number, number[]>();
  for (const i of cells) {
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y)!.push(x);
  }
  const runs = new Map<number, [number, number][]>();
  let y0 = 1e9;
  let y1 = -1;
  for (const [y, xs] of rows) {
    xs.sort((p, q) => p - q);
    const out: [number, number][] = [];
    for (const x of xs) {
      const last = out[out.length - 1];
      if (last && last[1] === x - 1) last[1] = x;
      else out.push([x, x]);
    }
    runs.set(y, out);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const plates: [number, number][] = [];
  for (const i of cells) {
    if (w.mark[i] !== F4_MARK.plate) continue;
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    if (w.mark[i - 1] === F4_MARK.plate || w.mark[i - w.w] === F4_MARK.plate) continue;
    plates.push([x, y]);
  }
  const peds = w.objs
    .filter((o) => o.ref === 'f4_astat' && b.cells.has(o.y * w.w + o.x))
    .sort((p, q) => p.y - q.y || p.x - q.x);
  a = {
    seatX: seat ? seat.x + 0.5 : b.obj.x + 0.5,
    seatY: seat ? seat.y + 0.5 : b.obj.y - 10,
    plates,
    peds,
    rows: runs,
    y0,
    y1,
  };
  arenas.set(w, a);
  return a;
}

/** Идол в бою (или null). */
function idolOf(sim: Sim): Mob | null {
  return sim.mobs.find((m) => m.kind === 'f4_idol' && m.mode !== 'dying') ?? null;
}

function say(sim: Sim, text: string, sub: string, what = 'f4_rule'): void {
  sim.events.push({ t: 'boss', what, text, sub });
}

/** Заповедь на скрижали: текст, круг у ног героя. */
function startRule(sim: Sim, b: BossFight, rule: number): void {
  const d = b.data;
  d.st = ST.rule;
  d.stT = 0;
  d.rule = rule;
  d.lastRule = rule;
  d.ax = sim.hero.x;
  d.ay = sim.hero.y;
  d.judging = 0;
  const [text, sub] = RULE_TEXT[rule];
  say(sim, text, sub);
}

/** Взор: зал заливают лучи, волнами с севера на юг; целы только светлые плиты. */
function startGaze(
  sim: Sim,
  b: BossFight,
  api: SimApi,
  idol: Mob,
  warn: number,
  second = false,
): void {
  const d = b.data;
  const A = arenaOf(sim, b);
  const h = sim.hero;
  d.st = ST.gaze;
  d.stT = 0;
  // Плиты: ближняя к герою — всегда, и ещё две-три случайные. Второй взор
  // фазы гнева прежнюю ближнюю не зажигает: горит следующая — перебеги.
  const byDist = A.plates
    .map((p, i) => ({ i, d: Math.hypot(p[0] + 1 - h.x, p[1] + 1 - h.y) }))
    .sort((p, q) => p.d - q.d);
  const lit = new Set<number>();
  const banned = second ? (d.prevPlate ?? -1) : -1;
  const near = byDist.find((p) => p.i !== banned);
  if (near) lit.add(near.i);
  const extra = 2 + (b.phase >= 1 ? 1 : 0);
  for (let k = 0; k < 40 && lit.size < 1 + extra && lit.size < A.plates.length - 1; k++) {
    const i = Math.floor(sim.rng() * A.plates.length);
    if (i !== banned) lit.add(i);
  }
  d.prevPlate = near?.i ?? -1;
  const safe = new Set<number>();
  const w = sim.world.w;
  for (const i of lit) {
    const [px, py] = A.plates[i];
    for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) safe.add((py + yy) * w + px + xx);
  }
  // Волны: четыре полосы зала по высоте, каждая на 0,25 с позже.
  const span = Math.max(1, A.y1 - A.y0 + 1);
  let last = 0;
  // Ряды без плит склеиваются в прямоугольники: меньше ударов, одна вспышка.
  let bandY0 = -1;
  let bandRuns: string = '';
  const flush = (yA: number, yB: number, runs: [number, number][]) => {
    const wave = Math.min(3, Math.floor(((yA + yB) / 2 - A.y0) / (span / 4)));
    const wn = warn + wave * 0.25;
    last = Math.max(last, wn);
    for (const [x0, x1] of runs) {
      const s = {
        shape: 'line' as const,
        x: x0,
        y: (yA + yB + 1) / 2,
        r: x1 + 1 - x0,
        w: (yB - yA + 1) / 2,
        ang: 0,
        warn: wn,
        dmg: idol.dmg * 1.4,
        knock: 3,
        art: 'f4_beam',
        from: idol.id,
      };
      api.strike(sim, s);
      const fz = { x: s.x, y: s.y, r: s.r, life: 0.35, warn: wn, art: 'f4_flash' }; // v2.85 — только рисунок
      api.zone(sim, { ...fz, above: true }); // v2.85 — только рисунок: свет поверх темноты
      // Полувысота полосы — рисовальщику, в `dur` (статуса у вспышки нет,
      // на героя она не действует: это только свет удара).
      const z = sim.zones[sim.zones.length - 1];
      z.dur = s.w;
    }
  };
  const rowRuns = (y: number): [number, number][] => {
    const out: [number, number][] = [];
    for (const [x0, x1] of A.rows.get(y) ?? []) {
      let s = -1;
      for (let x = x0; x <= x1 + 1; x++) {
        const open = x <= x1 && !safe.has(y * w + x);
        if (open && s < 0) s = x;
        if (!open && s >= 0) {
          out.push([s, x - 1]);
          s = -1;
        }
      }
    }
    return out;
  };
  let prev: [number, number][] = [];
  for (let y = A.y0; y <= A.y1 + 1; y++) {
    const runs = y <= A.y1 ? rowRuns(y) : [];
    const key = JSON.stringify(runs);
    // Полоса продолжается, пока ряды одинаковы и она не пересекает границу волны.
    const sameWave =
      bandY0 >= 0 &&
      Math.floor((y - A.y0) / (span / 4)) === Math.floor((bandY0 - A.y0) / (span / 4));
    if (bandY0 >= 0 && (key !== bandRuns || !sameWave || y > A.y1)) {
      flush(bandY0, y - 1, prev);
      bandY0 = -1;
    }
    if (bandY0 < 0 && y <= A.y1) {
      bandY0 = y;
      bandRuns = key;
      prev = runs;
    }
  }
  // Светлые плиты — видно, куда встать; гаснут вместе с последней волной.
  for (const i of lit) {
    const [px, py] = A.plates[i];
    api.zone(sim, { x: px + 1, y: py + 1, r: 1, life: last + 0.4, art: 'f4_plate' });
    const pz = { x: px + 1, y: py + 1, r: 1, life: last + 0.4 }; // v2.85 — только рисунок
    api.vfx(sim, { ...pz, art: 'f4_pillar', above: true }); // v2.85 — только рисунок: столб
  }
  d.gazeEnd = last + 0.35;
  const gz = { x: A.seatX, y: A.seatY, r: 1, life: last + 0.35 }; // v2.85 — только рисунок
  api.vfx(sim, { ...gz, art: 'f4_gazeray', above: true }); // v2.85 — только рисунок: взор
  say(sim, 'ВЗОР ИДОЛА', 'встань на светлую плиту', 'f4_gaze');
}

/** Разбудить стражей до `n` штук (ближние к трону — первыми). */
function wakeStatues(sim: Sim, b: BossFight, n: number): void {
  const A = arenaOf(sim, b);
  let awake = 0;
  const list = sim.mobs.filter((m) => m.kind === 'f4_statue' && m.mode !== 'dying');
  for (const m of list) if (m.mode !== 'dormant') awake += 1;
  for (const p of A.peds) {
    if (awake >= n) break;
    const m = list.find((s) => s.mode === 'dormant' && s.data.ped === A.peds.indexOf(p));
    if (!m) continue;
    m.mode = 'rise';
    m.t = 0;
    awake += 1;
    sim.events.push({ t: 'strike', x: m.x, y: m.y, art: 'f4_wake' });
  }
}

/** Разбитые стражи собираются на постаментах: груда дрожит и встаёт. */
function reformStatues(
  sim: Sim,
  b: BossFight,
  dt: number,
  api: SimApi,
  idol: Mob,
  cap: number,
): void {
  const A = arenaOf(sim, b);
  const d = b.data;
  const t = REFORM[Math.min(2, b.phase)];
  let awake = 0;
  for (const m of sim.mobs)
    if (m.kind === 'f4_statue' && m.mode !== 'dying' && m.mode !== 'dormant') awake += 1;
  for (let i = 0; i < A.peds.length; i++) {
    const key = `re${i}`;
    const alive = sim.mobs.some(
      (m) => m.kind === 'f4_statue' && m.mode !== 'dying' && m.data.ped === i,
    );
    if (alive) {
      d[key] = 0;
      continue;
    }
    const p = A.peds[i];
    if (!d[key]) {
      // Груда на постаменте: видно, что и когда встанет.
      d[key] = t;
      api.zone(sim, { x: p.x + 0.5, y: p.y + 0.5, r: 0.5, life: t, art: 'f4_reform' });
      continue;
    }
    d[key] -= dt;
    if (d[key] > 0) continue;
    if (awake >= cap) {
      // Места нет — ждёт; груда остаётся лежать.
      d[key] = 0.5;
      api.zone(sim, { x: p.x + 0.5, y: p.y + 0.5, r: 0.5, life: 0.5, art: 'f4_reform' });
      continue;
    }
    d[key] = 0;
    const s = api.spawnMob(sim, 'f4_statue', p.x + 0.5, p.y + 0.5, {
      mode: 'rise',
      level: idol.level,
    });
    s.data.ped = i;
    s.face = p.x < A.seatX ? 0 : Math.PI;
    // Собранный заново — тот же камень: опыта второй раз не даёт.
    s.xp = 0;
    awake += 1;
    sim.events.push({ t: 'strike', x: s.x, y: s.y, art: 'f4_wake' });
  }
}

registerBrain('f4_idol', {
  raw: true,
  step(sim, m, dt, _c, api) {
    if (m.mode === 'dying') return;
    const b = sim.boss;
    if (!b) return;
    const A = arenaOf(sim, b);
    // Сидит на троне: не двигается, отдача его не берёт.
    m.x = A.seatX;
    m.y = A.seatY;
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
    m.face = Math.PI / 2;
    const st = b.data.st ?? ST.rest;
    const open = st === ST.open || st === ST.spent;
    m.data.open = open ? 1 : 0;
    // Вне окна — камень: удары движка не берут, крохи урона — отбоем.
    if (open) m.data.ghost = 0;
    else {
      m.data.ghost = 1;
      const bl = bladeNow(sim);
      const was = m.data.parry; // v2.85 — только рисунок
      if (bl && covers(sim, bl, m)) parry(sim, m, bl, idolChip(b.data.broken ?? 0), true);
      if (m.data.parry !== was) vfxChip(sim, m, api); // v2.85 — только рисунок
    }
    // Удар рукой (фаза гнева): метка горит, рука поднята.
    if ((m.data.slamT ?? 0) > 0) m.data.slamT = Math.max(0, m.data.slamT - dt);
    void api;
  },
});

registerBoss('f4_idol', {
  start(_sim, b) {
    b.data.st = ST.rest;
    b.data.stT = 0;
    b.data.init = 0;
  },
  step(sim, b, dt, api) {
    const d = b.data;
    const idol = idolOf(sim);
    if (!idol) return;
    const A = arenaOf(sim, b);
    const h = sim.hero;
    if (!d.init) {
      d.init = 1;
      d.broken = 0;
      d.vol = 0;
      d.slamCd = 4;
      d.next = RULES.bow;
      // Подпись к пробуждению: чем этот бой отличается от других.
      for (const e of sim.events)
        if (e.t === 'boss' && e.what === 'wake') {
          e.text = 'КАМЕННЫЙ ИДОЛ';
          e.sub = 'статуи ожили — не отводи от них взгляд';
        }
      // Стражи на постаментах: статуями, пока идол не разбудит.
      A.peds.forEach((p, i) => {
        const s = api.spawnMob(sim, 'f4_statue', p.x + 0.5, p.y + 0.5, {
          mode: 'dormant',
          level: idol.level,
        });
        s.data.ped = i;
        s.face = p.x < A.seatX ? 0 : Math.PI;
      });
      wakeStatues(sim, b, PH[0].statues);
    }
    // Фазы по здоровью идола.
    const k = idol.hp / idol.maxHp;
    if (b.phase === 0 && k <= 2 / 3) {
      b.phase = 1;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'СТРАЖИ ПРОБУДИЛИСЬ',
        sub: 'их уже четверо — не отворачивайся',
      });
      wakeStatues(sim, b, PH[1].statues);
      api.vfx(sim, { x: h.x, y: h.y, r: 6, life: 2.4, art: 'f4_quake' }); // v2.85 — только рисунок
    } else if (b.phase === 1 && k <= 1 / 3) {
      b.phase = 2;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'ГНЕВ ИДОЛА',
        sub: 'двойной взор и удары руками',
      });
      wakeStatues(sim, b, PH[2].statues);
      api.vfx(sim, { x: h.x, y: h.y, r: 6, life: 2.4, art: 'f4_quake' }); // v2.85 — только рисунок
    }
    const P = PH[Math.min(2, b.phase)];
    d.stT = (d.stT ?? 0) + dt;
    reformStatues(sim, b, dt, api, idol, REFORM_CAP[Math.min(2, b.phase)]);
    const seatDist = Math.hypot(h.x - A.seatX, h.y - A.seatY);

    switch (d.st) {
      case ST.rest:
        if (d.stT >= P.rest) {
          // Заповедь и взор чередуются; заповеди идут по кругу, с середины
          // боя — и «опусти меч».
          if (d.lastWasRule) {
            d.lastWasRule = 0;
            d.vol = b.phase >= 2 ? 2 : 1;
            startGaze(sim, b, api, idol, P.warn);
          } else {
            d.lastWasRule = 1;
            const pool = b.phase >= 1 ? [1, 2, 3] : [1, 2];
            const i = pool.indexOf(d.next ?? 1);
            const rule = pool[i < 0 ? 0 : i];
            d.next = pool[(pool.indexOf(rule) + 1) % pool.length];
            startRule(sim, b, rule);
            // v2.85 — только рисунок: круг заповеди у ног и знак над головой;
            // `warn` — когда начнётся суд, `life` — суд и полсекунды приговора (v2.85).
            const jw = rule === RULES.sheathe ? SHEATHE_GRACE : P.rule - P.judge; // v2.85 — только рисунок
            const vz = { x: h.x, y: h.y, r: 0.9, warn: jw, life: P.rule - jw + 0.5 }; // v2.85 — только рисунок
            api.vfx(sim, { ...vz, art: 'f4_judge' }); // v2.85 — только рисунок
            api.vfx(sim, { ...vz, art: 'f4_sign', above: true }); // v2.85 — только рисунок
          }
        }
        break;
      case ST.rule: {
        const rule = d.rule;
        // «Опусти меч» судят почти всё время, но не с первого кадра: удар,
        // начатый до того, как заповедь загорелась, — не нарушение.
        const judging = rule === RULES.sheathe ? d.stT >= SHEATHE_GRACE : d.stT >= P.rule - P.judge;
        if (judging && !d.judging) {
          d.judging = 1;
          d.ax = h.x;
          d.ay = h.y;
        }
        // Отброшенного ударом стража не судят за шаг: якорь едет за ним.
        if (h.flash > 0) d.shove = 0.5;
        else d.shove = Math.max(0, (d.shove ?? 0) - dt);
        if (d.shove > 0) {
          d.ax = h.x;
          d.ay = h.y;
        }
        let broke = false;
        if (judging) {
          if (rule === RULES.bow)
            broke = h.mode === 'dash' || Math.hypot(h.x - d.ax, h.y - d.ay) > BOW_STEP;
          else if (rule === RULES.praise)
            broke =
              Math.abs(angDiff(Math.atan2(A.seatY - h.y, A.seatX - h.x), h.face)) > LOOK * 0.8;
          else
            broke =
              h.mode === 'attack' ||
              h.mode === 'heavy' ||
              h.mode === 'skill' ||
              h.mode === 'charge';
        }
        if (broke) {
          // КАРА: столб с потолка прямо в героя — заповедь была на табло.
          d.st = ST.wrath;
          d.stT = 0;
          api.hurtHero(sim, idol.dmg * 2, h.x, h.y - 0.5, 4, idol.kind);
          api.heroStatus(sim, 'stun', 0.8);
          const wz = { x: h.x, y: h.y, r: 0.9, life: 0.6, art: 'f4_wrath' }; // v2.85 — только рисунок
          api.zone(sim, { ...wz, above: true }); // v2.85 — только рисунок: столб поверх темноты
          api.vfx(sim, { ...wz, life: 1.8, art: 'f4_scorch' }); // v2.85 — только рисунок: ожог
          sim.events.push({ t: 'shake', k: 0.2 }); // v2.85 — только рисунок: с уроном ≈0,5
          sim.events.push({ t: 'flash', k: 0.5, color: '#ffe2a0' }); // v2.85 — только рисунок
          say(sim, 'КАРА', 'заповедь нарушена', 'f4_wrath');
        } else if (d.stT >= P.rule) {
          d.st = ST.open;
          d.stT = 0;
          say(sim, 'ЛИК ОТКРЫТ', 'идол уязвим — бей', 'f4_open');
        }
        break;
      }
      case ST.wrath:
        if (d.stT >= 1.1) {
          d.st = ST.rest;
          d.stT = 0;
        }
        break;
      case ST.open:
        if (d.stT >= P.open) {
          d.st = ST.rest;
          d.stT = 0;
        }
        break;
      case ST.gaze:
        if (d.stT >= (d.gazeEnd ?? 3)) {
          d.vol = (d.vol ?? 1) - 1;
          if (d.vol > 0) startGaze(sim, b, api, idol, P.warn * 0.75, true);
          else {
            d.st = ST.spent;
            d.stT = 0;
            say(sim, 'ГЛАЗА ПОГАСЛИ', 'идол уязвим — бей', 'f4_open');
          }
        }
        break;
      case ST.spent:
        if (d.stT >= P.spent) {
          d.st = ST.rest;
          d.stT = 0;
        }
        break;
    }

    // Фаза гнева: подошёл к трону — идол бьёт рукой (круг, метка честная).
    // Не во время заповеди: от руки не уйти, не нарушив «замри» или «смотри».
    d.slamCd = (d.slamCd ?? 4) - dt;
    const slamOk = d.st === ST.rest || d.st === ST.open || d.st === ST.spent;
    if (b.phase >= 2 && slamOk && seatDist < 4.2 && d.slamCd <= 0) {
      d.slamCd = 4.2;
      const side = h.x < A.seatX ? -1 : 1;
      const x = A.seatX + side * 1.1;
      const y = A.seatY + 2.1;
      api.strike(sim, {
        shape: 'circle',
        x,
        y,
        r: 1.9,
        warn: 0.95,
        dmg: idol.dmg * 1.5,
        knock: 7,
        art: 'f4_slam',
        from: idol.id,
      });
      idol.data.slamSide = side;
      idol.data.slamT = 1.15;
    }

    // Для рисовальщика: что горит на скрижали и у ног героя.
    const ruleName: F4Rule =
      d.st === ST.rule
        ? d.rule === RULES.bow
          ? 'bow'
          : d.rule === RULES.praise
            ? 'praise'
            : 'sheathe'
        : d.st === ST.gaze
          ? 'gaze'
          : '';
    F4_VIEW.rule = ruleName;
    F4_VIEW.ruleK = d.st === ST.rule ? Math.min(1, d.stT / P.rule) : 0;
    F4_VIEW.judging = d.st === ST.rule && !!d.judging;
    idol.data.st = d.st;
    idol.data.stK =
      d.st === ST.gaze
        ? Math.min(1, d.stT / Math.max(0.1, d.gazeEnd ?? 1))
        : d.st === ST.rule
          ? Math.min(1, d.stT / P.rule)
          : 0;
    idol.data.cracks = d.broken ?? 0;
    idol.data.phase = b.phase;
    // Круг заповеди у ног героя — идёт за ним.
    idol.tele =
      d.st === ST.rule
        ? { shape: 'ring', r: 0.9, w: 0.07, k: Math.min(1, d.stT / P.rule), x: h.x, y: h.y }
        : null;
  },
  onPartDown(sim, b, m, api) {
    // v2.85 — только рисунок: api — для зон пыли
    if (m.kind === 'f4_statue') {
      api.vfx(sim, { x: m.x, y: m.y, r: 0.5, life: 1.4, art: 'f4_crumble' }); // v2.85 — только рисунок
      sim.events.push({ t: 'shake', k: 0.2 }); // v2.85 — только рисунок: камень рассыпался
      const key = `cr${m.data.ped ?? 0}`;
      if (!b.data[key]) {
        b.data[key] = 1;
        b.data.broken = (b.data.broken ?? 0) + 1;
        say(sim, 'СТРАЖ РАЗБИТ', 'по идолу трещина — но страж соберётся', 'f4_crack');
      }
      return true;
    }
    if (m.kind === 'f4_idol') {
      // Идол пал — стражи рассыпаются вместе с ним.
      for (const s of sim.mobs)
        if (s.kind === 'f4_statue' && s.mode !== 'dying') {
          s.mode = 'dying';
          s.t = 0;
          s.hp = 0;
          s.tele = null;
          s.danger = 0;
          sim.events.push({ t: 'boom', x: s.x, y: s.y, r: 0 });
          api.vfx(sim, { x: s.x, y: s.y, r: 0.5, life: 1.4, art: 'f4_crumble' }); // v2.85 — только рисунок
        }
      sim.zones = sim.zones.filter((z) => z.art !== 'f4_reform');
      api.vfx(sim, { x: m.x, y: m.y, r: 3, life: 2.6, art: 'f4_collapse' }); // v2.85 — только рисунок
      F4_VIEW.rule = '';
      F4_VIEW.ruleK = 0;
      F4_VIEW.judging = false;
    }
    return false;
  },
  bar(sim) {
    const idol = sim.mobs.find((m) => m.kind === 'f4_idol');
    return idol ? Math.max(0, idol.hp) / idol.maxHp : 0;
  },
  reset() {
    F4_VIEW.rule = '';
    F4_VIEW.ruleK = 0;
    F4_VIEW.judging = false;
  },
});

// ---------------------------------------------------------------------------
// Правило этажа: живые стражи колоннады встают на постаменты, когда герой
// подходит (спят статуями — их не отличить от мёртвых), и вид трона.
// ---------------------------------------------------------------------------

const sentryPeds = new WeakMap<World, WorldObj[]>();

registerFloor(4, {
  start() {
    F4_VIEW.rule = '';
    F4_VIEW.ruleK = 0;
    F4_VIEW.judging = false;
  },
  step(sim, _dt, api) {
    const b = sim.boss;
    F4_VIEW.idol = !b
      ? 'intact'
      : b.state === 'fight'
        ? 'fight'
        : b.state === 'won' || b.state === 'rest'
          ? 'broken'
          : 'intact';
    if (!b || b.state !== 'fight') {
      F4_VIEW.rule = '';
      F4_VIEW.judging = false;
    }
    let peds = sentryPeds.get(sim.world);
    if (!peds) {
      peds = sim.world.objs.filter((o) => o.ref === 'f4_sped');
      sentryPeds.set(sim.world, peds);
    }
    const h = sim.hero;
    for (let i = 0; i < peds.length; i++) {
      const key = `sp${i}`;
      if (sim.floorData[key]) continue;
      const p = peds[i];
      if (Math.hypot(p.x + 0.5 - h.x, p.y + 0.5 - h.y) > 20) continue;
      sim.floorData[key] = 1;
      const s = api.spawnMob(sim, 'f4_sentry', p.x + 0.5, p.y + 0.5, { mode: 'sleep' });
      s.face = p.x < 32 ? 0 : Math.PI;
    }
  },
});
