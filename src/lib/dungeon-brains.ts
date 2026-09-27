// Библиотека ИИ монстров (v2.81): то, что годится любому этажу. Свой ИИ этаж
// регистрирует у себя (`dungeon-floors/fN-brains.ts`), здесь — общее:
//   melee   — подходит с фланга, замах, укус, отход; раненый бежит в нору
//             (серая и жирная крыса — ровно прежнее поведение);
//   bomber  — подбегает, ставит шашку и удирает;
//   flee    — удирает по полю расстояний и через 14 с уходит в нору;
//   ranged  — держит дистанцию, целится (линия на полу) и стреляет;
//   charger — прицел линией, рывок напролом, о стену — оглушён;
//   brute   — громила-босс заготовок: удар по кругу, рывок, подмога.

import { registerBoss, registerBrain } from './dungeon-ai';
import type { BrainCtx, SimApi } from './dungeon-ai';
import type { Mob, Sim } from './dungeon-sim';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Ближний бой.
// ---------------------------------------------------------------------------

function melee(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const h = sim.hero;
  const { dx, dy, dist, def } = c;
  switch (m.mode) {
    case 'chase': {
      const reach = def.reach + m.r + h.r;
      if (dist < reach && m.cd <= 0) {
        api.setMode(m, 'windup');
        m.face = Math.atan2(dy, dx);
        return;
      }
      // Стая обходит с флангов: у каждого своя сторона.
      let tx = h.x;
      let ty = h.y;
      if (!m.rush && dist > 1.6) {
        const side = ((m.id * 2.399) % TAU) - Math.PI;
        const r = Math.min(1.4, dist * 0.35);
        tx += Math.cos(side) * r;
        ty += Math.sin(side) * r;
      }
      let [cx, cy] = api.chaseDir(sim, m, tx, ty);
      // Зигзаг пасюка — только издали.
      if (def.zigzag && dist > 2.2) {
        const z = Math.sin(sim.time * 9 + m.id) * 0.55;
        const px = -cy;
        const py = cx;
        cx += px * z;
        cy += py * z;
        const l = Math.hypot(cx, cy) || 1;
        cx /= l;
        cy /= l;
      }
      const s = m.speed * (m.rush ? 1.15 : 1) * (dist < 1.4 ? 0.6 : 1);
      api.steer(sim, m, cx, cy, s, dt);
      return;
    }
    case 'windup':
      m.vx *= 0.75;
      m.vy *= 0.75;
      if (m.t >= def.windup) {
        const reach = def.reach + m.r + h.r + 0.18;
        if (dist < reach) {
          const st = def.hit?.status;
          api.hurtHero(
            sim,
            m.dmg,
            m.x,
            m.y,
            def.hit?.push ?? 2,
            m.kind,
            st ? { kind: st, dur: def.hit?.dur ?? 2 } : undefined,
          );
        }
        // Рывок вперёд на укусе.
        m.vx += Math.cos(m.face) * 3;
        m.vy += Math.sin(m.face) * 3;
        api.setMode(m, 'recover');
        m.cd = def.rest * (0.8 + sim.rng() * 0.4);
      }
      return;
    case 'recover':
      api.steer(sim, m, -dx / (dist || 1), -dy / (dist || 1), m.speed * 0.35, dt);
      if (m.t > 0.35) {
        // Раненый иногда бежит в нору — догонять или отпустить.
        if (m.hp < m.maxHp * 0.3 && sim.rng() < 0.35 && m.burrow >= 0) api.setMode(m, 'flee');
        else api.setMode(m, 'chase');
      }
      return;
    case 'flee': {
      const b = sim.burrows[m.burrow];
      if (!b) {
        api.setMode(m, 'chase');
        return;
      }
      const [ox, oy] = b.obj.out!;
      const tx = ox + 0.5 - m.x;
      const ty = oy + 0.5 - m.y;
      const d = Math.hypot(tx, ty);
      api.steer(sim, m, tx / (d || 1), ty / (d || 1), m.speed * 1.1, dt);
      if (d < 0.4) {
        api.setMode(m, 'escape');
        m.hp = 0;
      }
      if (m.t > 4) api.setMode(m, 'chase');
      return;
    }
    default:
      // Незнакомый режим (например, после чужого ИИ) — снова в погоню.
      if (m.mode !== 'plant') api.setMode(m, 'chase');
  }
}

registerBrain('melee', { step: melee });

// ---------------------------------------------------------------------------
// Подрывник: подбежал, поставил шашку, удрал. Убит с шашкой — она горит.
// ---------------------------------------------------------------------------

registerBrain('bomber', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    if (m.mode === 'chase') {
      const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
      api.steer(sim, m, cx, cy, m.speed, dt);
      if (dist < 2.7 && m.cd <= 0 && api.lineOfSight(sim, m.x, m.y, h.x, h.y))
        api.setMode(m, 'plant');
      return;
    }
    if (m.mode === 'plant') {
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t > 0.5) {
        sim.bombs.push({
          id: sim.nextId++,
          x: m.x,
          y: m.y,
          vx: 0,
          vy: 0,
          fuse: 1.6,
          r: 1.8,
          dmg: m.dmg,
        });
        sim.events.push({ t: 'fuse', x: m.x, y: m.y });
        api.setMode(m, 'flee');
        m.cd = 4.5;
      }
      return;
    }
    if (m.mode === 'flee') {
      api.steer(sim, m, -dx / (dist || 1), -dy / (dist || 1), m.speed * 1.1, dt);
      if (m.t > 1.3) api.setMode(m, 'chase');
      return;
    }
    melee(sim, m, dt, c, api);
  },
  onDeath(sim, m, mode) {
    if (mode !== 'plant') return;
    sim.bombs.push({
      id: sim.nextId++,
      x: m.x,
      y: m.y,
      vx: 0,
      vy: 0,
      fuse: 1.1,
      r: 1.8,
      dmg: m.dmg,
    });
  },
});

// ---------------------------------------------------------------------------
// Беглец: золотая крыса. Удирает по полю расстояний прочь, к норе.
// ---------------------------------------------------------------------------

registerBrain('flee', {
  step(sim, m, dt, c, api) {
    const { dx, dy, dist } = c;
    const away = api.flowDir(sim, m.x, m.y, true);
    const d = away ?? [-dx / (dist || 1), -dy / (dist || 1)];
    api.steer(sim, m, d[0], d[1], m.speed, dt);
    if (m.t > 14 && dist > 5) {
      api.setMode(m, 'escape');
      m.hp = 0;
    }
  },
});

// ---------------------------------------------------------------------------
// Стрелок: держит дистанцию `reach`, целится линией и стреляет `shot`.
// ---------------------------------------------------------------------------

registerBrain('ranged', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    const range = Math.max(2.5, def.reach);
    const shot = def.shot;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist < range + 0.5 && m.cd <= 0 && shot) {
          api.setMode(m, 'aim');
          m.face = Math.atan2(dy, dx);
          return;
        }
        // Слишком близко — отходит, далеко или не видно — подходит.
        if (dist < range * 0.55 && see) {
          const away = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
          api.steer(sim, m, away[0], away[1], m.speed, dt);
        } else {
          const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
          api.steer(sim, m, cx, cy, dist < range ? m.speed * 0.4 : m.speed, dt);
        }
        return;
      }
      case 'aim': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        // Прицел доводится две трети замаха, потом замирает — видно, куда.
        if (m.t < def.windup * 0.66) m.face = Math.atan2(dy, dx);
        m.tele = { shape: 'line', r: range + 1, w: 0.18, ang: m.face, k: m.t / def.windup };
        if (m.t >= def.windup) {
          m.tele = null;
          if (shot) api.shoot(sim, m, m.face, shot, h.x, h.y);
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      }
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.4) api.setMode(m, 'chase');
        return;
      default:
        melee(sim, m, dt, c, api);
    }
  },
});

// ---------------------------------------------------------------------------
// Таран: прицел линией, рывок напролом; о стену — оглушён и открыт.
// ---------------------------------------------------------------------------

registerBrain('charger', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    switch (m.mode) {
      case 'chase': {
        if (dist < 6 && m.cd <= 0 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'aim');
          m.dir = Math.atan2(dy, dx);
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'aim':
        m.vx *= 0.75;
        m.vy *= 0.75;
        if (m.t < def.windup * 0.6) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = { shape: 'line', r: 7, w: m.r, ang: m.dir, k: m.t / def.windup };
        m.danger = m.t > def.windup - 0.25 ? 4 : 0;
        if (m.t >= def.windup) {
          m.tele = null;
          m.bounce = true;
          api.setMode(m, 'charge');
        }
        return;
      case 'charge': {
        const s = m.speed * 3.2;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.danger = m.r + h.r + 1.2;
        if (dist < m.r + h.r + 0.1 && h.inv <= 0 && h.mode !== 'dash') {
          api.hurtHero(sim, m.dmg * 1.3, m.x, m.y, 8, m.kind);
          m.bounce = false;
          m.danger = 0;
          api.setMode(m, 'recover');
          m.cd = def.rest * 2;
          return;
        }
        if (m.t > 1.4) {
          m.bounce = false;
          m.danger = 0;
          api.setMode(m, 'recover');
          m.cd = def.rest * 2;
        }
        return;
      }
      case 'dizzy':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > 1.2) api.setMode(m, 'chase');
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.5) api.setMode(m, 'chase');
        return;
      default:
        melee(sim, m, dt, c, api);
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'charge') return;
    m.bounce = false;
    m.danger = 0;
    sim.hitstop = Math.max(sim.hitstop, 0.05);
    sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
    api.setMode(m, 'dizzy');
    m.cd = 1;
  },
});

// ---------------------------------------------------------------------------
// Громила-босс заготовок: удар по кругу, рывок линией, с половины — подмога.
// ---------------------------------------------------------------------------

registerBrain('brute', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    const b = sim.boss;
    const haste = b && b.t > 180 ? 1.3 : 1;
    if (m.mode === 'dying') return;
    switch (m.mode) {
      case 'roar':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 1.2) api.setMode(m, 'chase');
        return;
      case 'chase': {
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * haste, dt);
        if (m.t > 1.3 / haste) {
          if (dist < 2.6 || sim.rng() < 0.45) {
            api.setMode(m, 'slam');
            api.strike(sim, {
              shape: 'circle',
              x: m.x,
              y: m.y,
              r: 2.3,
              warn: 0.85 / haste,
              dmg: m.dmg * 1.2,
              knock: 7,
              from: m.id,
              art: 'slam',
            });
          } else {
            api.setMode(m, 'aim');
            m.dir = Math.atan2(dy, dx);
          }
        }
        return;
      }
      case 'slam':
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > 1.1 / haste) api.setMode(m, 'chase');
        return;
      case 'aim':
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < 0.45) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = { shape: 'line', r: 8, w: m.r, ang: m.dir, k: m.t / 0.8 };
        m.danger = m.t > 0.6 ? 4 : 0;
        if (m.t > 0.8 / haste) {
          m.tele = null;
          m.bounce = true;
          api.setMode(m, 'charge');
        }
        return;
      case 'charge': {
        const s = 9 * haste;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.danger = m.r + h.r + 1.4;
        if (dist < m.r + h.r + 0.1 && h.inv <= 0 && h.mode !== 'dash') {
          api.hurtHero(sim, m.dmg * 1.4, m.x, m.y, 9, m.kind);
          m.bounce = false;
          m.danger = 0;
          api.setMode(m, 'dizzy');
          return;
        }
        if (m.t > 2) {
          m.bounce = false;
          m.danger = 0;
          api.setMode(m, 'dizzy');
        }
        return;
      }
      case 'dizzy':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > 1.3) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
    void def;
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'charge') return;
    m.bounce = false;
    m.danger = 0;
    sim.hitstop = Math.max(sim.hitstop, 0.05);
    sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
    api.setMode(m, 'dizzy');
  },
});

registerBoss('brute', {
  step(sim, b, dt, api) {
    const lead = sim.mobs.find((m) => m.kind === b.def.mob && m.mode !== 'dying');
    if (!lead) return;
    // С половины здоровья — подмога из нор арены, раз в 14 с.
    if (b.phase === 0 && lead.hp < lead.maxHp * 0.5) {
      b.phase = 1;
      sim.events.push({ t: 'boss', what: 'phase', text: 'ЗОВЁТ ПОДМОГУ' });
    }
    if (b.phase >= 1) {
      b.data.help = (b.data.help ?? 4) - dt;
      if (b.data.help <= 0) {
        b.data.help = 14;
        const holes = sim.burrows.filter(
          (x) => x.obj.out && api.inArena(sim, x.obj.out[0] + 0.5, x.obj.out[1] + 0.5),
        );
        const kind = api.pickKind(sim, b.obj.area);
        for (let i = 0; i < 2 && holes.length; i++) {
          const hb = holes[i % holes.length];
          hb.cd = 0;
          const mm = api.fromBurrow(sim, hb, kind);
          mm.t = -i * 0.25;
        }
      }
    }
  },
});
