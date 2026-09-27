// Этаж 1 — ИИ и сценарий босса. КАРКАС v2.81: Крысиный король перенесён из
// движка как есть (катится, хлещет хвостами, зовёт стаю, при смерти
// распадается на трёх малых). Агент первого этажа переделывает его.

import { registerBoss, registerBrain } from '../dungeon-ai';
import type { BrainCtx, SimApi } from '../dungeon-ai';
import type { Mob, Sim } from '../dungeon-sim';

function kingStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const h = sim.hero;
  const b = sim.boss!;
  const { dx, dy, dist } = c;
  const enraged = b.t > 180;
  const haste = enraged ? 1.3 : 1;
  const small = m.kind === 'kinglet';
  m.summonCd -= dt;
  switch (m.mode) {
    case 'roar':
      if (m.t > 1.2) api.setMode(m, 'chase');
      return;
    case 'chase': {
      const s = m.speed * haste;
      api.steer(sim, m, dx / (dist || 1), dy / (dist || 1), s, dt);
      if (m.t > (small ? 0.9 : 1.4) / haste) {
        const r = sim.rng();
        if (!small && m.summonCd <= 0 && r < 0.3) {
          api.setMode(m, 'summon');
          sim.events.push({ t: 'boss', what: 'summon' });
        } else if (dist > 2.6 || r < 0.45) {
          api.setMode(m, 'rollAim');
          m.dir = Math.atan2(dy, dx);
        } else {
          api.setMode(m, 'whipAim');
        }
      }
      return;
    }
    case 'rollAim':
      m.vx *= 0.8;
      m.vy *= 0.8;
      // Прицел доводится первые полсекунды, потом замирает — видно, куда покатится.
      if (m.t < 0.45) m.dir = Math.atan2(dy, dx);
      if (m.t > 0.8 / haste) {
        api.setMode(m, 'roll');
        m.bounces = 0;
        sim.events.push({ t: 'boss', what: 'roll' });
      }
      return;
    case 'roll': {
      const s = (small ? 10 : 9) * haste;
      m.vx = Math.cos(m.dir) * s;
      m.vy = Math.sin(m.dir) * s;
      // Качение бьёт один раз: попал — король и сам оглушён ударом, это
      // окно для ответа. Иначе он катался бы по арене, задевая снова и снова.
      if (dist < m.r + h.r + 0.1 && h.inv <= 0 && h.mode !== 'dash') {
        api.hurtHero(sim, m.dmg * 1.4, m.x, m.y, 9, m.kind);
        api.setMode(m, 'dizzy');
        return;
      }
      if (m.t > 2.2) api.setMode(m, 'dizzy');
      return;
    }
    case 'dizzy':
      m.vx *= 0.85;
      m.vy *= 0.85;
      if (m.t > (small ? 0.8 : 1.3)) api.setMode(m, 'chase');
      return;
    case 'whipAim':
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t > 0.7 / haste) {
        const r = small ? 1.7 : 2.1;
        if (dist < r + h.r) api.hurtHero(sim, m.dmg, m.x, m.y, 6, m.kind);
        sim.events.push({ t: 'boss', what: 'whip' });
        sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
        api.setMode(m, 'recover');
      }
      return;
    case 'summon':
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t > 1) {
        const holes = sim.burrows.filter((x) =>
          api.inArena(sim, x.obj.out![0] + 0.5, x.obj.out![1] + 0.5),
        );
        const n = 3 + Math.floor(sim.rng() * 2);
        for (let i = 0; i < n && holes.length; i++) {
          const hb = holes[i % holes.length];
          hb.cd = 0;
          const mm = api.fromBurrow(sim, hb, 'rat', { elite: i === 0 && sim.rng() < 0.2 });
          mm.t = -i * 0.2;
        }
        m.summonCd = 12;
        api.setMode(m, 'chase');
      }
      return;
    case 'recover':
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > 0.6) api.setMode(m, 'chase');
      return;
    case 'stun':
      if (m.t > 0.4) api.setMode(m, 'chase');
      return;
    default:
      if (m.mode !== 'dying') api.setMode(m, 'chase');
  }
}

registerBrain('king', {
  raw: true,
  step(sim, m, dt, c, api) {
    kingStep(sim, m, dt, c, api);
    const h = sim.hero;
    const small = m.kind === 'kinglet';
    const haste = sim.boss && sim.boss.t > 180 ? 1.3 : 1;
    // Катится — отскакивает от стен (`onWall`).
    m.bounce = m.mode === 'roll';
    // Метки на полу и окно уклона в последний миг.
    m.tele = null;
    m.danger = 0;
    if (m.mode === 'rollAim') {
      m.tele = { shape: 'line', r: 7, w: m.r, ang: m.dir, k: Math.min(1, m.t / 0.8) };
      if (m.t > 0.6) m.danger = 4;
    } else if (m.mode === 'roll') m.danger = m.r + h.r + 1.4;
    else if (m.mode === 'whipAim') {
      m.tele = { shape: 'ring', r: small ? 1.7 : 2.1, k: Math.min(1, (m.t * haste) / 0.7) };
      if (m.t > 0.5) m.danger = 2.6;
    }
  },
  onWall(sim, m, nx, ny, api) {
    if (m.mode !== 'roll') return;
    // Король отскакивает от стены: зеркалим направление по нормали.
    if (Math.abs(nx) > Math.abs(ny)) m.dir = Math.PI - m.dir;
    else m.dir = -m.dir;
    m.bounces += 1;
    sim.hitstop = Math.max(sim.hitstop, 0.05);
    sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
    if (m.bounces > 1) api.setMode(m, 'dizzy');
  },
});

registerBoss('king', {
  start(_sim, _b, lead) {
    lead.summonCd = 8;
  },
  onPartDown(sim, b, m, api) {
    if (m.kind !== 'king' || b.split) return false;
    // Король пал — распадается на трёх малых.
    b.split = true;
    m.mode = 'dying';
    m.t = 0;
    sim.events.push({ t: 'boss', what: 'split' });
    sim.hitstop = Math.max(sim.hitstop, 0.12);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const k = api.spawnMob(sim, 'kinglet', m.x + Math.cos(a) * 1.2, m.y + Math.sin(a) * 1.2, {
        mode: 'stun',
        level: m.level,
      });
      k.hp = k.maxHp = m.maxHp * 0.18;
      k.kx = Math.cos(a) * 6;
      k.ky = Math.sin(a) * 6;
      api.collide(sim, k);
    }
    return true;
  },
  bar(sim) {
    // Одна полоса на весь бой: король — первые 60%, малые после раскола —
    // последние 40%. Иначе на расколе полоса прыгала бы обратно к полной.
    const king = sim.mobs.find((m) => m.kind === 'king' && m.mode !== 'dying');
    if (king) return 0.4 + (0.6 * Math.max(0, king.hp)) / king.maxHp;
    let hp = 0;
    let max = 0;
    for (const m of sim.mobs)
      if (m.kind === 'kinglet') {
        hp += Math.max(0, m.hp);
        max += m.maxHp;
      }
    return max > 0 ? (0.4 * hp) / max : 0;
  },
});
