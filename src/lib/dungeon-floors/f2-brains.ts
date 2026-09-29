// Этаж 2 — ИИ монстров, правила этажа и сценарий Живых доспехов.
//
// Экосистема грота:
//   гриб-топотун — топает (круг у ног), от удара чихает облачком спор,
//     умирая — лопается большим облаком (яд);
//   слизь — капает со свода на голову, прыгает с меткой приземления и вяжет;
//     обычный удар режет её надвое, тяжёлый — давит целиком;
//   мандрагора — сидит в земле (недосягаема), подпускает и кричит: круг на
//     полу, внутри — оглушение; выйти или проскочить рывком; после крика
//     выдыхается — окно для ответа;
//   сундучный рак (мимик) — сундук среди сундуков, пока не подошёл;
//     подошёл — лапы, укус с меткой, бочком обходит; ушёл далеко — вернётся
//     домой и снова притворится;
//   хваталка — лиана в полу: целится линией и выстреливает пастью, потом
//     долго втягивается;
//   грибница ест мёртвых: убитый на грибнице через несколько секунд
//     прорастает грибёнком.
//
// Живые доспехи — три такта:
//   1) ЛАТЫ: рубящий взмах (конус), выпад (линия с рывком, о стену —
//      оглушён), с половины — двойной взмах и прыжок с ударом по кругу; от
//      ударов из щелей сыплются латники;
//   2) РОЙ: латы разбиты — обломки разлетаются (метки падения), рой на воле,
//      клинок летает сам и колет выпадом; у роя есть время;
//   3) СБОРКА: не добил рой — обломки и латники ползут друг к другу, и латы
//      встают снова с частью здоровья: чем больше латников доползло, тем
//      крепче. Добил рой — победа.
// Механики короля (перекат, хлыст, подмога из нор) здесь нет: своя —
// сборка лат, пока жив рой, и живой клинок.

import { BRAINS, registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi } from '../dungeon-ai';
import type { BossFight, Mob, Sim } from '../dungeon-sim';
import { F2_ARMOR, F2_BLADE, F2_MITE, F2_PLATE, MK } from './f2';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Общее.
// ---------------------------------------------------------------------------

/** Сколько здоровья снято с прошлого шага (ИИ узнаёт об ударе так). */
function hurtOf(m: Mob): number {
  const was = m.data.hp0 ?? m.hp;
  m.data.hp0 = m.hp;
  return Math.max(0, was - m.hp);
}

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';

/** Врос в пол: стоит на месте, отдача и толчки не сдвигают. */
function pin(m: Mob): void {
  m.x = m.hx;
  m.y = m.hy;
  m.vx = 0;
  m.vy = 0;
  m.kx = 0;
  m.ky = 0;
}

/** Сколько пола до стены по лучу, клеток (не дальше `max`). */
function rayLen(sim: Sim, api: SimApi, x: number, y: number, ang: number, max: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.25; d <= max; d += 0.25)
    if (api.solidTile(sim, Math.floor(x + ux * d), Math.floor(y + uy * d))) return d - 0.25;
  return max;
}

/** Попадает ли круг (x, y, r) в полосу от (ox, oy) по углу `ang`. */
function inLine(
  ox: number,
  oy: number,
  ang: number,
  len: number,
  w: number,
  x: number,
  y: number,
  r: number,
): boolean {
  const dx = x - ox;
  const dy = y - oy;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const along = dx * ux + dy * uy;
  const across = Math.abs(-dx * uy + dy * ux);
  return along > -r && along < len + r && across < w + r;
}

// ---------------------------------------------------------------------------
// Правила этажа: места монстров, капель, грибница.
// ---------------------------------------------------------------------------

type SpotKind = 'mandrake' | 'mimic' | 'snapper';

interface Spot {
  kind: SpotKind;
  x: number;
  y: number;
  /** Кто сейчас сидит на месте (id моба), 0 — никого. */
  id: number;
  /** Убит в этой вылазке — до следующей не вернётся. */
  dead: boolean;
}

interface Drip {
  x: number;
  y: number;
  /** Сколько ждать, пока слизь снова наберётся на своде, с. */
  cd: number;
}

interface Sprouting {
  x: number;
  y: number;
  t: number;
}

interface FloorState {
  spots: Spot[];
  drips: Drip[];
  sprouts: Sprouting[];
  scan: number;
}

const STATE = new WeakMap<Sim, FloorState>();

/** Сколько клеток до героя — ближе этого место оживает. */
const SPOT_WAKE = 15;
/** Капель срабатывает, если герой прошёл под ней, и ждёт столько, с. */
const DRIP_R = 1.5;
const DRIP_CD = 80;
/** Грибница прорастает убитого через столько секунд. */
const SPROUT_T = 6;

function floorState(sim: Sim): FloorState {
  let fs = STATE.get(sim);
  if (fs) return fs;
  fs = { spots: [], drips: [], sprouts: [], scan: 0 };
  const w = sim.world;
  for (let i = 0; i < w.mark.length; i++) {
    const mk = w.mark[i];
    const x = (i % w.w) + 0.5;
    const y = Math.floor(i / w.w) + 0.5;
    if (mk === MK.mandrake) fs.spots.push({ kind: 'mandrake', x, y, id: 0, dead: false });
    else if (mk === MK.mimic) fs.spots.push({ kind: 'mimic', x, y, id: 0, dead: false });
    else if (mk === MK.snapper) fs.spots.push({ kind: 'snapper', x, y, id: 0, dead: false });
    else if (mk === MK.drip) fs.drips.push({ x, y, cd: 0 });
  }
  STATE.set(sim, fs);
  return fs;
}

const SPOT_MOB: Record<SpotKind, [string, string]> = {
  mandrake: ['f2_mandrake', 'emerge'],
  mimic: ['f2_mimic', 'sleep'],
  snapper: ['f2_snapper', 'idle'],
};

/** Убит тот, кто сидел на месте: до конца вылазки место пустует. */
function spotDown(sim: Sim, m: Mob): void {
  const fs = STATE.get(sim);
  const i = m.data.spot;
  if (!fs || i === undefined) return;
  const s = fs.spots[i];
  if (s && s.id === m.id) s.dead = true;
}

/** Слизь со свода падает на голову: метка приземления и тень. */
function dropSlime(sim: Sim, api: SimApi, x: number, y: number, delay: number): void {
  const m = api.spawnMob(sim, 'f2_slime', x, y, { mode: 'drop' });
  m.t = -delay;
  api.strike(sim, {
    shape: 'circle',
    x,
    y,
    r: 0.72,
    warn: 0.55 + delay,
    dmg: m.dmg,
    knock: 2,
    status: 'slow',
    dur: 2,
    art: 'f2_hop',
    from: m.id,
  });
}

registerFloor(2, {
  start(sim) {
    floorState(sim);
  },
  step(sim, dt, api) {
    const fs = floorState(sim);
    const h = sim.hero;
    const bossOn = sim.boss?.state === 'fight';
    const down = heroDown(sim);

    // Грибница ест мёртвых: убитый на ней прорастает грибёнком.
    for (const e of sim.events) {
      if (e.t !== 'kill' || bossOn || e.mob === 'f2_sprout') continue;
      if (e.mob === F2_MITE || e.mob === F2_ARMOR) continue;
      const i = Math.floor(e.y) * sim.world.w + Math.floor(e.x);
      if (sim.world.mark[i] !== MK.mycel || fs.sprouts.length >= 3 || sim.rng() > 0.6) continue;
      fs.sprouts.push({ x: e.x, y: e.y, t: SPROUT_T });
      api.zone(sim, { x: e.x, y: e.y, r: 0.5, life: SPROUT_T, art: 'f2_sprouting' });
    }
    for (const s of fs.sprouts) {
      s.t -= dt;
      if (s.t > 0) continue;
      if (!down && Math.hypot(s.x - h.x, s.y - h.y) < 20) {
        const m = api.spawnMob(sim, 'f2_sprout', s.x, s.y, { mode: 'emerge' });
        m.hx = s.x;
        m.hy = s.y;
      }
    }
    fs.sprouts = fs.sprouts.filter((s) => s.t > 0);

    // Капель: прошёл под ней — сверху шлёпается слизь.
    for (const d of fs.drips) {
      if (d.cd > 0) {
        d.cd -= dt;
        continue;
      }
      if (down || bossOn || Math.hypot(d.x - h.x, d.y - h.y) > DRIP_R) continue;
      d.cd = DRIP_CD;
      // Метка — туда, куда герой шагнёт: успеваешь увидеть тень и уйти.
      let tx = h.x + h.vx * 0.3;
      let ty = h.y + h.vy * 0.3;
      if (api.solidTile(sim, Math.floor(tx), Math.floor(ty))) {
        tx = h.x;
        ty = h.y;
      }
      dropSlime(sim, api, tx, ty, 0);
      if (sim.rng() < 0.35) {
        const a = sim.rng() * TAU;
        const x2 = tx + Math.cos(a) * 1.4;
        const y2 = ty + Math.sin(a) * 1.4;
        if (!api.solidTile(sim, Math.floor(x2), Math.floor(y2))) dropSlime(sim, api, x2, y2, 0.35);
      }
      sim.events.push({ t: 'squeak', x: tx, y: ty });
    }

    // Места монстров: оживают, когда герой рядом, и не повторяются, если убиты.
    fs.scan -= dt;
    if (fs.scan > 0) return;
    fs.scan = 0.3;
    for (let i = 0; i < fs.spots.length; i++) {
      const s = fs.spots[i];
      if (s.dead) continue;
      if (s.id && sim.mobs.some((m) => m.id === s.id && m.mode !== 'dying')) continue;
      s.id = 0;
      if (Math.hypot(s.x - h.x, s.y - h.y) > SPOT_WAKE) continue;
      if (api.inArena(sim, s.x, s.y)) continue;
      const [kind, mode] = SPOT_MOB[s.kind];
      const m = api.spawnMob(sim, kind, s.x, s.y, { mode });
      m.data.spot = i;
      m.data.ghost = s.kind === 'snapper' ? 0 : 1;
      m.face = 0;
      s.id = m.id;
    }
  },
});

// ---------------------------------------------------------------------------
// Гриб-топотун.
// ---------------------------------------------------------------------------

/** Радиус топота. */
export const STOMP_R = 1.15;

registerBrain('f2_shroom', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.data.puffCd = (m.data.puffCd ?? 0) - dt;
    m.data.squish = Math.max(0, (m.data.squish ?? 0) - dt);
    // Удар по шляпке выбивает облачко спор — не чаще раза в 2,4 с.
    if (hurtOf(m) > 0 && m.hp > 0 && m.data.puffCd <= 0) {
      m.data.puffCd = 2.4;
      m.data.squish = 0.35;
      api.zone(sim, {
        x: m.x,
        y: m.y,
        r: 0.95,
        life: 2,
        warn: 0.3,
        status: 'poison',
        dur: 1.2,
        art: 'f2_spores',
      });
    }
    switch (m.mode) {
      case 'chase': {
        if (dist < STOMP_R + h.r - 0.2 && m.cd <= 0) {
          api.setMode(m, 'stomp');
          m.face = Math.atan2(dy, dx);
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * (dist < 1.4 ? 0.55 : 1), dt);
        return;
      }
      case 'stomp': {
        // Замах: поднимает ногу — круг у ног наливается; потом удар.
        m.vx *= 0.7;
        m.vy *= 0.7;
        const w = def.windup;
        m.tele = { shape: 'circle', r: STOMP_R, k: Math.min(1, m.t / w) };
        m.danger = m.t > w - 0.25 ? STOMP_R + h.r + 0.3 : 0;
        if (m.t >= w) {
          m.tele = null;
          m.danger = 0;
          if (dist < STOMP_R + h.r) api.hurtHero(sim, m.dmg, m.x, m.y, 4, m.kind);
          sim.events.push({ t: 'strike', x: m.x, y: m.y, art: 'f2_stomp' });
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      }
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.55) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m, _mode, api) {
    // Лопается облаком спор: добил вплотную — отойди.
    api.zone(sim, {
      x: m.x,
      y: m.y,
      r: 1.5,
      life: 3.2,
      warn: 0.35,
      status: 'poison',
      dur: 1.5,
      art: 'f2_spores',
    });
    void sim;
  },
});

// ---------------------------------------------------------------------------
// Сводовая слизь.
// ---------------------------------------------------------------------------

const HOP_AIM = 0.6;
const HOP_T = 0.32;
export const HOP_R = 0.78;

/** Обычный удар режет слизь надвое: две половинки разлетаются в стороны. */
function split(sim: Sim, m: Mob, api: SimApi): void {
  const def = api.def(m.kind);
  const hp = Math.max(1, m.hp * 0.6);
  sim.strikes = sim.strikes.filter((s) => s.from !== m.id);
  m.tele = null;
  m.data.gen = 1;
  m.maxHp *= 0.6;
  m.hp = hp;
  m.data.hp0 = hp;
  m.r = def.radius * 0.74;
  m.xp *= 0.5;
  const b = api.spawnMob(sim, m.kind, m.x, m.y, { mode: 'stun', level: m.level });
  b.maxHp = m.maxHp;
  b.hp = hp;
  b.data.hp0 = hp;
  b.data.gen = 1;
  b.r = m.r;
  b.xp = m.xp;
  b.loot = m.loot;
  b.elite = false;
  b.albino = m.albino;
  b.affixes = [];
  // Тот же взмах, что разрезал, половинку не задевает: она ещё летит.
  b.data.ghost = 1;
  const a = Math.atan2(m.y - sim.hero.y, m.x - sim.hero.x) + Math.PI / 2;
  m.kx += Math.cos(a) * 5;
  m.ky += Math.sin(a) * 5;
  b.kx -= Math.cos(a) * 5;
  b.ky -= Math.sin(a) * 5;
  api.collide(sim, b);
  api.setMode(m, 'stun');
  sim.events.push({ t: 'strike', x: m.x, y: m.y, art: 'f2_split' });
}

registerBrain('f2_slime', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    // Половинка приземлилась — снова досягаема.
    if (m.data.ghost) m.data.ghost = 0;
    // Режется или давится: решает, чем ударили.
    if (hurtOf(m) > 0 && m.hp > 0 && !m.data.gen && h.mode !== 'heavy') {
      split(sim, m, api);
      return;
    }
    switch (m.mode) {
      case 'chase': {
        if (dist < 2.4 && m.cd <= 0 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'hopAim');
          m.face = Math.atan2(dy, dx);
          m.data.tx = h.x;
          m.data.ty = h.y;
          api.strike(sim, {
            shape: 'circle',
            x: h.x,
            y: h.y,
            r: HOP_R,
            warn: HOP_AIM + HOP_T,
            dmg: m.dmg,
            knock: 2,
            status: 'slow',
            dur: 2.2,
            art: 'f2_hop',
            from: m.id,
          });
          return;
        }
        // Ползёт толчками, как гусеница.
        const pulse = 0.45 + 0.55 * Math.max(0, Math.sin(sim.time * 5 + m.id));
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * pulse, dt);
        return;
      }
      case 'hopAim':
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t >= HOP_AIM) api.setMode(m, 'hop');
        return;
      case 'hop': {
        const left = Math.max(0.04, HOP_T - m.t);
        const tx = m.data.tx ?? m.x;
        const ty = m.data.ty ?? m.y;
        let vx = (tx - m.x) / left;
        let vy = (ty - m.y) / left;
        const v = Math.hypot(vx, vy);
        if (v > 10) {
          vx *= 10 / v;
          vy *= 10 / v;
        }
        m.vx = vx;
        m.vy = vy;
        if (m.t >= HOP_T) {
          m.vx *= 0.2;
          m.vy *= 0.2;
          // Где шлёпнулась — лужа слизи: вязнет.
          api.zone(sim, { x: m.x, y: m.y, r: 0.8, life: 4, slow: 0.55, art: 'f2_goo' });
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      }
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.7) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Мандрагора. Режим 'emerge' — «в земле»: движок такого не двигает, не
// сталкивает и не даёт бить; ИИ ведёт все режимы сам.
// ---------------------------------------------------------------------------

export const SCREAM_R = 3;
const SCREAM_T = 1.05;
const WAKE_R = 2.9;

registerBrain('f2_mandrake', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dist } = c;
    pin(m);
    m.danger = 0;
    m.tele = null;
    const down = heroDown(sim);
    switch (m.mode) {
      case 'emerge':
        m.data.ghost = 1;
        if (!down && m.cd <= 0 && dist < WAKE_R && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'rise');
          m.data.ghost = 0;
        }
        return;
      case 'rise':
        m.data.ghost = 0;
        if (m.t > 0.4) {
          api.setMode(m, 'scream');
          api.strike(sim, {
            shape: 'circle',
            x: m.x,
            y: m.y,
            r: SCREAM_R,
            warn: SCREAM_T,
            dmg: m.dmg,
            knock: 1,
            status: 'stun',
            dur: 1.4,
            art: 'f2_scream',
            from: m.id,
          });
        }
        return;
      case 'scream':
        if (m.t > SCREAM_T - 0.3) m.danger = SCREAM_R + h.r + 0.2;
        if (m.t >= SCREAM_T + 0.3) api.setMode(m, 'tired');
        return;
      case 'stun':
        // Удар сбил крик: сразу выдохлась.
        sim.strikes = sim.strikes.filter((s) => s.from !== m.id);
        api.setMode(m, 'tired');
        return;
      case 'tired':
        if (m.t > 2.4 || dist > 7) api.setMode(m, 'sink');
        return;
      case 'sink':
        if (m.t > 0.5) {
          api.setMode(m, 'emerge');
          m.data.ghost = 1;
          m.cd = 2 + sim.rng();
          m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.25);
        }
        return;
      default:
        api.setMode(m, 'emerge');
    }
    void dt;
  },
  onDeath(sim, m) {
    spotDown(sim, m);
  },
});

// ---------------------------------------------------------------------------
// Сундучный рак (мимик).
// ---------------------------------------------------------------------------

/** Ближе этого «сундук» открывается сам — раньше, чем появится «Тайник». */
export const MIMIC_WAKE = 1.9;

registerBrain('f2_mimic', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    const down = heroDown(sim);
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'sleep':
        // Сундук. Раз в несколько секунд крышка чуть приподнимается —
        // внимательный заметит. Режим «сон»: движок не уводит такого
        // далеко от героя и не рисует ему глаз.
        m.data.ghost = 1;
        pin(m);
        m.face = 0;
        m.data.tw = (m.data.tw ?? 3 + (m.id % 5)) - dt;
        if (m.data.tw < -0.3) m.data.tw = 5 + sim.rng() * 4;
        if (!down && dist < MIMIC_WAKE) {
          api.setMode(m, 'spring');
          m.data.ghost = 0;
          m.face = Math.atan2(dy, dx);
          sim.events.push({ t: 'clank', x: m.x, y: m.y });
        }
        return;
      case 'spring':
        // Крышка откинулась, лапы вышли — и сразу бросок с меткой.
        m.data.ghost = 0;
        pin(m);
        if (m.t >= 0.25) {
          m.dir = Math.atan2(dy, dx);
          m.face = m.dir;
          api.strike(sim, {
            shape: 'cone',
            x: m.x,
            y: m.y,
            r: 1.7,
            ang: m.dir,
            arc: 1.4,
            warn: 0.4,
            dmg: m.dmg * 1.2,
            knock: 5,
            art: 'f2_bite',
            from: m.id,
          });
          api.setMode(m, 'lunge');
        }
        return;
      case 'lunge':
        if (m.t < 0.4) {
          m.vx *= 0.6;
          m.vy *= 0.6;
          m.danger = m.t > 0.2 ? 2 : 0;
        } else if (m.t < 0.58) {
          m.vx = Math.cos(m.dir) * 7;
          m.vy = Math.sin(m.dir) * 7;
        } else {
          api.setMode(m, 'recover');
          m.cd = 0.6;
        }
        return;
      case 'chase': {
        if (down || dist > 9) {
          api.setMode(m, 'home');
          return;
        }
        const reach = def.reach + m.r + h.r;
        if (dist < reach && m.cd <= 0) {
          api.setMode(m, 'windup');
          m.face = Math.atan2(dy, dx);
          return;
        }
        // Бочком, как краб: заходит сбоку, меняя сторону.
        m.data.side = m.data.side ?? (m.id % 2 ? 1 : -1);
        m.data.flip = (m.data.flip ?? 1.4) - dt;
        if (m.data.flip <= 0) {
          m.data.side = -m.data.side;
          m.data.flip = 1.1 + sim.rng() * 0.8;
        }
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        const off = dist > 1.2 ? Math.min(1.3, dist * 0.45) : 0;
        const tx = h.x - ny * m.data.side * off;
        const ty = h.y + nx * m.data.side * off;
        const [cx, cy] = api.chaseDir(sim, m, tx, ty);
        api.steer(sim, m, cx, cy, m.speed, dt);
        m.face = Math.atan2(dy, dx);
        return;
      }
      case 'windup':
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t >= def.windup) {
          const reach = def.reach + m.r + h.r + 0.18;
          if (dist < reach) api.hurtHero(sim, m.dmg, m.x, m.y, 4, m.kind);
          m.vx += Math.cos(m.face) * 3;
          m.vy += Math.sin(m.face) * 3;
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.4) api.setMode(m, 'chase');
        return;
      case 'stun':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > def.stunT!) api.setMode(m, 'chase');
        return;
      case 'home': {
        const hx = m.hx - m.x;
        const hy = m.hy - m.y;
        const d = Math.hypot(hx, hy);
        if (!down && dist < 4) {
          api.setMode(m, 'chase');
          return;
        }
        if (d < 0.3) {
          api.setMode(m, 'close');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, m.hx, m.hy);
        api.steer(sim, m, cx, cy, m.speed * 0.8, dt);
        return;
      }
      case 'close':
        pin(m);
        m.face = 0;
        if (m.t > 0.45) {
          // Спрятался — зализал раны.
          m.hp = m.maxHp;
          m.data.hp0 = m.hp;
          api.setMode(m, 'sleep');
        }
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m) {
    spotDown(sim, m);
  },
});

// ---------------------------------------------------------------------------
// Хваталка.
// ---------------------------------------------------------------------------

export const SNAP_R = 3.3;
const SNAP_AIM = 0.75;
const SNAP_W = 0.38;

registerBrain('f2_snapper', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    pin(m);
    m.tele = null;
    m.danger = 0;
    m.data.ghost = 0;
    const down = heroDown(sim);
    switch (m.mode) {
      case 'idle':
        m.data.ext = 0;
        if (
          !down &&
          m.cd <= 0 &&
          dist < SNAP_R + 0.5 &&
          dist > 0.6 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y)
        ) {
          api.setMode(m, 'aim');
          m.dir = Math.atan2(dy, dx);
        }
        return;
      case 'aim': {
        // Прицел доводится почти до конца и замирает — видно, куда хлестнёт.
        if (m.t < SNAP_AIM - 0.3) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = rayLen(sim, api, m.x, m.y, m.dir, SNAP_R);
        m.data.len = len;
        m.tele = { shape: 'line', r: len, w: SNAP_W, ang: m.dir, k: Math.min(1, m.t / SNAP_AIM) };
        if (m.t > SNAP_AIM - 0.25) m.danger = len + 0.8;
        if (m.t >= SNAP_AIM) {
          if (!down && inLine(m.x, m.y, m.dir, len, SNAP_W, h.x, h.y, h.r) && h.mode !== 'dash')
            api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind);
          sim.events.push({
            t: 'strike',
            x: m.x + Math.cos(m.dir) * len,
            y: m.y + Math.sin(m.dir) * len,
            art: 'f2_snap',
          });
          api.setMode(m, 'snap');
        }
        return;
      }
      case 'snap':
        m.data.ext = Math.min(1, m.t / 0.08);
        if (m.t > 0.3) api.setMode(m, 'retract');
        return;
      case 'retract':
        // Лежит плетью и втягивается — окно для ответа.
        m.data.ext = Math.max(0, 1 - m.t / 1.2);
        if (m.t > 1.2) {
          api.setMode(m, 'idle');
          m.cd = def.rest * (0.7 + sim.rng() * 0.5);
        }
        return;
      case 'stun':
        api.setMode(m, 'retract');
        return;
      default:
        api.setMode(m, 'idle');
    }
    void dt;
  },
  onDeath(sim, m) {
    spotDown(sim, m);
  },
});

// ---------------------------------------------------------------------------
// Живые доспехи.
// ---------------------------------------------------------------------------

/** Латников в латах на старте боя. */
export const MITES0 = 16;
/** Сколько живёт рой, пока латы не начнут собираться: первый раз и потом, с. */
export const SWARM_T = [11, 9];
/** Сколько длится сборка, с. */
export const GATHER_T = 3.2;
/** Доля полосы — латы; остальное — рой. */
const W_ARM = 0.7;

const SWING = { r: 2.6, arc: 2.1, warn: 0.72 };
const THRUST = { r: 3.9, w: 0.5, aim: 0.32, warn: 0.4 };
const LEAP = { crouch: 0.5, air: 0.72, r: 1.75 };

const bossOf = (sim: Sim): BossFight | null =>
  sim.boss && sim.boss.state === 'fight' && sim.boss.def.script === 'f2_armor' ? sim.boss : null;

const aliveMites = (sim: Sim) =>
  sim.mobs.filter((x) => x.kind === F2_MITE && x.mode !== 'dying' && x.mode !== 'escape');

/** Латник из щели: рой сыплется, когда латы трещат. */
function shedMite(sim: Sim, b: BossFight, m: Mob, api: SimApi): void {
  if ((b.data.mites ?? 0) <= 3) return;
  b.data.mites -= 1;
  const a = sim.rng() * TAU;
  const k = api.spawnMob(sim, F2_MITE, m.x + Math.cos(a) * 0.6, m.y + Math.sin(a) * 0.4, {
    mode: 'stun',
    level: m.level,
  });
  k.kx = Math.cos(a) * 5;
  k.ky = Math.sin(a) * 5;
  k.data.ghost = 1;
  api.collide(sim, k);
}

registerBrain('f2_armor', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    const b = bossOf(sim);
    const angry = !!b && (b.phase >= 1 || (b.data.breaks ?? 0) > 0);
    m.data.angry = angry ? 1 : 0;
    const haste = angry ? 1.2 : 1;
    m.tele = null;
    m.danger = 0;
    m.bounce = false;
    if (m.mode === 'dying') return;
    // От ударов латы трещат: с половины из щелей сыплются латники — не
    // больше пяти за латы (рой должен остаться роем).
    if (hurtOf(m) > 0 && b) {
      m.data.hits = (m.data.hits ?? 0) + 1;
      if (angry && m.data.hits % 6 === 0 && (m.data.shed ?? 0) < 5) {
        m.data.shed = (m.data.shed ?? 0) + 1;
        shedMite(sim, b, m, api);
      }
    }
    if (heroDown(sim)) {
      m.vx *= 0.8;
      m.vy *= 0.8;
      return;
    }
    switch (m.mode) {
      case 'roar':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 1.2) api.setMode(m, 'chase');
        return;
      case 'rebuild':
        // Встаёт из обломков: пока собирается — не бьётся и не бьёт.
        m.data.ghost = 1;
        m.vx = 0;
        m.vy = 0;
        if (m.t > 0.95) {
          m.data.ghost = 0;
          api.setMode(m, 'roar');
          sim.events.push({ t: 'boss', what: 'roar' });
        }
        return;
      case 'chase': {
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * haste * (dist < 1.6 ? 0.4 : 1), dt);
        m.data.think = (m.data.think ?? 0.9) - dt;
        if (m.data.think > 0) return;
        m.data.think = (1 + sim.rng() * 0.4) / haste;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        const r = sim.rng();
        if (dist < 2.9) {
          if (r < 0.62) startSwing(sim, m, api, SWING.warn / haste);
          else startThrust(m, dx, dy);
        } else if (angry && (r < 0.45 || dist > 5.5)) {
          api.setMode(m, 'crouch');
        } else if (see && dist < 5.5) {
          startThrust(m, dx, dy);
        }
        return;
      }
      case 'swing': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        const warn = m.data.warn ?? SWING.warn;
        if (m.t > warn - 0.25) m.danger = SWING.r + h.r;
        if (m.t >= warn + 0.12) {
          // Ярость: второй взмах вдогонку, с другой руки.
          if (angry && !m.data.combo) {
            m.data.combo = 1;
            startSwing(sim, m, api, 0.45);
            return;
          }
          m.data.combo = 0;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'thrustAim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < THRUST.aim) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        if (!m.data.struck && m.t >= THRUST.aim) {
          m.data.struck = 1;
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: THRUST.r,
            w: THRUST.w,
            ang: m.dir,
            warn: THRUST.warn / haste,
            dmg: m.dmg * 1.2,
            knock: 7,
            art: 'f2_thrust',
            from: m.id,
          });
        }
        if (m.t < THRUST.aim)
          m.tele = { shape: 'line', r: THRUST.r, w: THRUST.w, ang: m.dir, k: m.t / THRUST.aim };
        if (m.t > THRUST.aim + THRUST.warn / haste - 0.25) m.danger = 4.2;
        if (m.t >= THRUST.aim + THRUST.warn / haste) {
          api.setMode(m, 'lunge');
          m.data.struck = 0;
        }
        return;
      }
      case 'lunge':
        // Выпад за клинком: с разгона о стену — оглушён и открыт.
        m.bounce = true;
        m.vx = Math.cos(m.dir) * 11;
        m.vy = Math.sin(m.dir) * 11;
        if (m.t > 0.2) {
          m.vx *= 0.3;
          m.vy *= 0.3;
          api.setMode(m, 'recover');
          m.data.rec = 0.85;
        }
        return;
      case 'crouch':
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t >= LEAP.crouch / haste) {
          // Прыжок туда, где герой сейчас: метка горит весь полёт.
          let tx = h.x;
          let ty = h.y;
          if (api.inArena(sim, tx, ty) === false && b) {
            tx = b.obj.x + 0.5;
            ty = b.obj.y + 0.5;
          }
          m.data.sx = m.x;
          m.data.sy = m.y;
          m.data.tx = tx;
          m.data.ty = ty;
          api.strike(sim, {
            shape: 'circle',
            x: tx,
            y: ty,
            r: LEAP.r,
            warn: LEAP.air,
            dmg: m.dmg * 1.3,
            knock: 8,
            art: 'f2_leap',
            from: m.id,
          });
          api.setMode(m, 'air');
        }
        return;
      case 'air': {
        m.data.ghost = 1;
        const k = Math.min(1, m.t / LEAP.air);
        m.x = m.data.sx + (m.data.tx - m.data.sx) * k;
        m.y = m.data.sy + (m.data.ty - m.data.sy) * k;
        m.vx = 0;
        m.vy = 0;
        if (m.t > LEAP.air - 0.2) m.danger = LEAP.r + h.r + 0.2;
        if (k >= 1) {
          m.data.ghost = 0;
          api.collide(sim, m);
          sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
          api.setMode(m, 'recover');
          m.data.rec = 1;
        }
        return;
      }
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > (m.data.rec ?? 0.6)) {
          m.data.rec = 0.6;
          api.setMode(m, 'chase');
        }
        return;
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
    if (m.mode !== 'lunge') return;
    m.bounce = false;
    sim.hitstop = Math.max(sim.hitstop, 0.05);
    sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
    api.setMode(m, 'dizzy');
  },
});

function startSwing(sim: Sim, m: Mob, api: SimApi, warn: number): void {
  const h = sim.hero;
  api.setMode(m, 'swing');
  m.dir = Math.atan2(h.y - m.y, h.x - m.x);
  m.face = m.dir;
  m.data.warn = warn;
  api.strike(sim, {
    shape: 'cone',
    x: m.x,
    y: m.y,
    r: SWING.r,
    ang: m.dir,
    arc: SWING.arc,
    warn,
    dmg: m.dmg,
    knock: 6,
    art: 'f2_sword',
    from: m.id,
  });
}

function startThrust(m: Mob, dx: number, dy: number): void {
  m.mode = 'thrustAim';
  m.t = 0;
  m.dir = Math.atan2(dy, dx);
  m.face = m.dir;
  m.data.struck = 0;
}

// Латник: кусается, как крыса стаи; на сборке ползёт к латам и лезет внутрь.
/** Доля латников, что успевают отпрыгнуть от обычного взмаха. */
export const MITE_DODGE = 0.45;
/** Рой кружит кольцом такого радиуса вокруг героя. */
const RING_R = 2.9;
/** Сколько латников налетает разом: при латах и на воле. */
const DARTS = [1, 3];
/** Сколько длится налёт и сколько ждать следующего, с. */
const DART_T = 2.2;
const DART_WAIT = [1.4, 2.4];

registerBrain(F2_MITE, {
  step(sim, m, dt, c, api) {
    const b = bossOf(sim);
    const h = sim.hero;
    // Прыжок в сторону от клинка: пока в воздухе — недосягаем.
    if (m.mode === 'hop') {
      m.data.ghost = 1;
      if (m.t > 0.22) {
        m.data.ghost = 0;
        api.setMode(m, 'chase');
        m.cd = Math.max(m.cd, 0.2);
      }
      return;
    }
    // Отлетел и оглушение прошло — снова досягаем.
    if (m.data.ghost) m.data.ghost = 0;
    // Рой — как стая рыб: на замах обычного удара часть прыгает прочь.
    // Тяжёлый удар и вихрь не угадать — от них не прыгают.
    const swing = Math.round((sim.time - h.t) * 1000);
    if (m.mode !== 'gather' && h.mode === 'attack' && h.t < 0.05 && m.data.swing !== swing) {
      m.data.swing = swing;
      const dx = m.x - h.x;
      const dy = m.y - h.y;
      const d = Math.hypot(dx, dy);
      let off = Math.atan2(dy, dx) - h.aim;
      while (off > Math.PI) off -= Math.PI * 2;
      while (off < -Math.PI) off += Math.PI * 2;
      if (d < 2 && Math.abs(off) < 1.2 && sim.rng() < MITE_DODGE) {
        api.setMode(m, 'hop');
        m.data.ghost = 1;
        const a = Math.atan2(dy, dx) + (sim.rng() - 0.5) * 1.2;
        m.kx += Math.cos(a) * 9;
        m.ky += Math.sin(a) * 9;
        m.tele = null;
        return;
      }
    }
    if (m.mode === 'gather' && b) {
      const gx = b.data.gx;
      const gy = b.data.gy;
      const d = Math.hypot(gx - m.x, gy - m.y);
      if (d < 0.5) {
        b.data.inside = (b.data.inside ?? 0) + 1;
        m.hp = 0;
        m.tele = null;
        api.setMode(m, 'escape');
        return;
      }
      const [cx, cy] = api.chaseDir(sim, m, gx, gy);
      api.steer(sim, m, cx, cy, m.speed * 0.7, dt);
      return;
    }
    if (m.mode === 'gather') api.setMode(m, 'chase');
    const melee = BRAINS.get('melee')!.step;
    if (!b) {
      melee(sim, m, dt, c as BrainCtx, api);
      return;
    }
    // Налёт: латник бросается кусать, потом отходит обратно в кольцо.
    if ((m.data.dart ?? 0) > 0) {
      m.data.dart -= dt;
      if (m.mode === 'recover') m.data.dart = Math.min(m.data.dart, 0.3);
      if (m.mode === 'ring') api.setMode(m, 'chase');
      melee(sim, m, dt, c as BrainCtx, api);
      if (m.data.dart <= 0 && m.mode === 'chase') {
        m.data.dart = 0;
        api.setMode(m, 'ring');
        m.data.wait = DART_WAIT[0] + sim.rng() * DART_WAIT[1];
      }
      return;
    }
    // Укус начат — довести.
    if (m.mode === 'windup' || m.mode === 'recover') {
      melee(sim, m, dt, c as BrainCtx, api);
      return;
    }
    if (m.mode !== 'ring') {
      api.setMode(m, 'ring');
      m.data.wait = sim.rng() * DART_WAIT[1];
    }
    // Кольцо: рой кружит на расстоянии и по нескольку налетает.
    const dist = c.dist;
    m.data.wait = (m.data.wait ?? 0) - dt;
    const cap = (b.data.stage ?? 0) === 1 ? DARTS[1] : DARTS[0];
    if (m.data.wait <= 0 && dist < 7) {
      let darting = 0;
      for (const x of sim.mobs) if (x.kind === F2_MITE && (x.data.dart ?? 0) > 0) darting++;
      if (darting < cap) {
        m.data.dart = DART_T;
        api.setMode(m, 'chase');
        return;
      }
      m.data.wait = 0.3 + sim.rng() * 0.5;
    }
    if (!m.data.side || sim.rng() < dt * 0.25) m.data.side = sim.rng() < 0.5 ? -1 : 1;
    const R = RING_R + (m.id % 3) * 0.4;
    const a = Math.atan2(m.y - h.y, m.x - h.x) + m.data.side * 0.6;
    const len = rayLen(sim, api, h.x, h.y, a, R + 0.4);
    const rr = Math.max(0.8, Math.min(R, len - 0.4));
    const [cx, cy] = api.chaseDir(sim, m, h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr);
    api.steer(sim, m, cx, cy, m.speed * (dist < R - 0.8 ? 1.15 : 0.75), dt);
    m.face = Math.atan2(h.y - m.y, h.x - m.x);
  },
});

// Обломок лат: летит, лежит, ползёт к остальным.
registerBrain(F2_PLATE, {
  raw: true,
  step(sim, m, dt, _c, api) {
    m.data.ghost = 1;
    const b = bossOf(sim);
    switch (m.mode) {
      case 'fly': {
        const T = m.data.T ?? 0.5;
        const left = T - m.t;
        if (left <= 0) {
          m.vx = 0;
          m.vy = 0;
          api.setMode(m, 'lie');
          sim.events.push({ t: 'clank', x: m.x, y: m.y });
          return;
        }
        m.vx = (m.data.tx - m.x) / left;
        m.vy = (m.data.ty - m.y) / left;
        return;
      }
      case 'lie':
        m.vx *= 0.5;
        m.vy *= 0.5;
        // Дрожит тем сильнее, чем ближе сборка.
        if (b && b.data.stage === 1)
          m.data.tw = Math.max(0, 1 - b.data.swarmT / (b.data.swarmT0 || 1));
        return;
      case 'gather': {
        if (!b) return;
        const dx = b.data.gx - m.x;
        const dy = b.data.gy - m.y;
        const d = Math.hypot(dx, dy);
        m.data.tw = 1;
        if (d < 0.3) {
          m.vx = 0;
          m.vy = 0;
          return;
        }
        const s = Math.min(d / 0.25, m.speed * (0.6 + (b.data.gatherT ?? 0) / GATHER_T));
        api.steer(sim, m, dx / d, dy / d, s, dt);
        return;
      }
      default:
        m.vx *= 0.5;
        m.vy *= 0.5;
    }
  },
});

// Живой клинок: вьётся вокруг героя и колет выпадом по линии.
registerBrain(F2_BLADE, {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    const b = bossOf(sim);
    m.data.ghost = 1;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'fly': {
        const T = m.data.T ?? 0.5;
        const left = T - m.t;
        if (left <= 0) {
          api.setMode(m, 'hover');
          m.cd = 1.4;
          return;
        }
        m.vx = (m.data.tx - m.x) / left;
        m.vy = (m.data.ty - m.y) / left;
        m.dir += dt * 14;
        return;
      }
      case 'hover': {
        m.data.orb = (m.data.orb ?? sim.rng() * TAU) + dt * 0.7;
        const tx = h.x + Math.cos(m.data.orb) * 2.8;
        const ty = h.y + Math.sin(m.data.orb) * 2.2;
        const [cx, cy] = api.chaseDir(sim, m, tx, ty);
        const d = Math.hypot(tx - m.x, ty - m.y);
        api.steer(sim, m, cx, cy, Math.min(def.speed, d * 3), dt);
        m.dir = Math.atan2(dy, dx);
        if (m.cd <= 0 && dist < 5 && !heroDown(sim)) api.setMode(m, 'aim');
        return;
      }
      case 'aim': {
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t < 0.5) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = { shape: 'line', r: 4.2, w: 0.3, ang: m.dir, k: Math.min(1, m.t / 0.8) };
        if (m.t > 0.55) m.danger = 4.6;
        if (m.t >= 0.8) {
          m.data.hit = 0;
          api.setMode(m, 'stab');
        }
        return;
      }
      case 'stab':
        m.vx = Math.cos(m.dir) * 17;
        m.vy = Math.sin(m.dir) * 17;
        if (!m.data.hit && dist < m.r + h.r + 0.25 && h.mode !== 'dash') {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg, m.x, m.y, 6, m.kind);
        }
        if (m.t > 0.24) {
          m.vx *= 0.2;
          m.vy *= 0.2;
          api.setMode(m, 'hover');
          m.cd = def.rest * (0.9 + sim.rng() * 0.3);
        }
        return;
      case 'gather': {
        if (!b) return;
        const gx = b.data.gx - m.x;
        const gy = b.data.gy - 0.2 - m.y;
        const d = Math.hypot(gx, gy);
        m.dir = -Math.PI / 2;
        if (d < 0.2) {
          m.vx = 0;
          m.vy = 0;
          return;
        }
        api.steer(sim, m, gx / d, gy / d, Math.min(def.speed, d * 2), dt);
        return;
      }
      default:
        api.setMode(m, 'hover');
    }
  },
});

/** Латы разбиты: обломки разлетаются, рой на воле, клинок взлетает. */
function burst(sim: Sim, b: BossFight, armor: Mob, api: SimApi): void {
  b.data.stage = 1;
  b.data.breaks = (b.data.breaks ?? 0) + 1;
  b.data.swarmT0 = SWARM_T[Math.min(SWARM_T.length - 1, b.data.breaks - 1)];
  b.data.swarmT = b.data.swarmT0;
  b.data.inside = 0;
  const n = b.data.mites ?? MITES0;
  b.data.mites = 0;
  sim.hitstop = Math.max(sim.hitstop, 0.12);
  sim.slowmo = Math.max(sim.slowmo, 0.45);
  sim.events.push({ t: 'flash', k: 0.7, color: '#b07cff' }); // v2.85 — только рисунок
  sim.events.push({
    t: 'boss',
    what: 'phase',
    text: 'ЛАТЫ РАЗБИТЫ',
    sub: `рой на воле — добей за ${b.data.swarmT0} секунд`,
  });
  // Рой.
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + sim.rng() * 0.4;
    const k = api.spawnMob(sim, F2_MITE, armor.x + Math.cos(a) * 0.4, armor.y + Math.sin(a) * 0.3, {
      mode: 'stun',
      level: armor.level,
    });
    const s = 5 + sim.rng() * 4;
    k.kx = Math.cos(a) * s;
    k.ky = Math.sin(a) * s;
    k.t = -sim.rng() * 0.25;
    // Пока разлетаются — недосягаемы: добивающий латы взмах рой не косит.
    k.data.ghost = 1;
    api.collide(sim, k);
  }
  // Обломки: куда упадут — там метка; клинок — тоже обломок, но летает.
  const parts = [0, 1, 2, 3, 4, 5];
  for (const part of parts) {
    const a = (part / parts.length) * TAU + sim.rng() * 0.6;
    const len = rayLen(sim, api, armor.x, armor.y, a, 1.8 + sim.rng() * 1.6);
    let tx = armor.x + Math.cos(a) * Math.max(0.6, len - 0.3);
    let ty = armor.y + Math.sin(a) * Math.max(0.6, len - 0.3);
    if (!api.inArena(sim, tx, ty)) {
      tx = armor.x;
      ty = armor.y;
    }
    const blade = part === 5;
    const p = api.spawnMob(sim, blade ? F2_BLADE : F2_PLATE, armor.x, armor.y, {
      mode: 'fly',
      level: armor.level,
    });
    p.data.part = part;
    p.data.tx = tx;
    p.data.ty = ty;
    p.data.T = 0.45 + sim.rng() * 0.15;
    p.data.ghost = 1;
    p.dir = a;
    p.data.vL = Math.cos(armor.face) < 0 ? 1 : 0; // v2.85 — только рисунок
    if (!blade)
      api.strike(sim, {
        shape: 'circle',
        x: tx,
        y: ty,
        r: 0.6,
        warn: p.data.T,
        dmg: armor.dmg * 0.5,
        knock: 4,
        art: 'f2_shard',
      });
  }
}

/** Рой не добит — латы собираются: всё ползёт к одной точке. */
function startGather(sim: Sim, b: BossFight): void {
  b.data.stage = 2;
  b.data.gatherT = 0;
  const plates = sim.mobs.filter((x) => x.kind === F2_PLATE && x.mode !== 'dying');
  let gx = b.obj.x + 0.5;
  let gy = b.obj.y + 0.5;
  if (plates.length) {
    gx = plates.reduce((s, p) => s + p.x, 0) / plates.length;
    gy = plates.reduce((s, p) => s + p.y, 0) / plates.length;
  }
  if (!b.cells.has(Math.floor(gy) * sim.world.w + Math.floor(gx))) {
    gx = b.obj.x + 0.5;
    gy = b.obj.y + 0.5;
  }
  b.data.gx = gx;
  b.data.gy = gy;
  for (const x of sim.mobs) {
    if (x.mode === 'dying') continue;
    if (x.kind === F2_PLATE || x.kind === F2_BLADE || (x.kind === F2_MITE && x.mode !== 'escape')) {
      x.mode = 'gather';
      x.t = 0;
      x.tele = null;
    }
  }
  sim.strikes = sim.strikes.filter((s) => s.art !== 'f2_shard');
  sim.events.push({
    t: 'boss',
    what: 'phase',
    text: 'ДОСПЕХ СОБИРАЕТСЯ',
    sub: 'руби латников, пока они ползут к латам',
  });
}

/** Сколько здоровья у собранных лат, по числу латников внутри. */
export const reformShare = (inside: number) => Math.max(0.2, Math.min(0.8, 0.16 + inside * 0.055));

/** Латы встают снова: внутри — все, кто дополз. */
function reform(sim: Sim, b: BossFight, api: SimApi): void {
  let inside = b.data.inside ?? 0;
  for (const x of aliveMites(sim)) {
    inside += 1;
    x.hp = 0;
    x.mode = 'escape';
    x.t = 0;
  }
  const gx = b.data.gx ?? b.obj.x + 0.5;
  const gy = b.data.gy ?? b.obj.y + 0.5;
  const vPs = sim.mobs.filter((x) => x.kind === F2_PLATE || x.kind === F2_BLADE); // v2.85 — только рисунок
  const vP: Record<string, number> = {}; // v2.85 — только рисунок
  for (const x of vPs) vP[`vP${x.kind === F2_BLADE ? 5 : x.data.part}x`] = (x.x - gx) * 16; // v2.85 — только рисунок
  for (const x of vPs) vP[`vP${x.kind === F2_BLADE ? 5 : x.data.part}y`] = (x.y - gy) * 16; // v2.85 — только рисунок
  sim.mobs = sim.mobs.filter((x) => x.kind !== F2_PLATE && x.kind !== F2_BLADE);
  const level = sim.mobs.find((x) => x.kind === F2_MITE)?.level;
  const a = api.spawnMob(sim, F2_ARMOR, gx, gy, { mode: 'rebuild', level });
  a.hp = a.maxHp * reformShare(inside);
  a.data.hp0 = a.hp;
  Object.assign(a.data, vP); // v2.85 — только рисунок
  a.data.ghost = 1;
  api.collide(sim, a);
  b.data.mites = inside;
  b.data.inside = 0;
  b.data.stage = 0;
  b.data.reformHp = a.hp / a.maxHp;
  b.phase = Math.max(b.phase, 1);
  sim.hitstop = Math.max(sim.hitstop, 0.1);
  sim.events.push({
    t: 'boss',
    what: 'phase',
    text: 'ЛАТЫ СОБРАНЫ',
    sub: `внутри ${inside} латников — разбей снова`,
  });
}

registerBoss('f2_armor', {
  start(_sim, b, lead) {
    b.data.mites = MITES0;
    b.data.stage = 0;
    b.data.breaks = 0;
    lead.data.hp0 = lead.hp;
  },
  step(sim, b, dt, api) {
    const stage = b.data.stage ?? 0;
    if (stage === 0) {
      const armor = sim.mobs.find((x) => x.kind === F2_ARMOR && x.mode !== 'dying');
      if (armor && b.phase === 0 && armor.hp < armor.maxHp * 0.5) {
        b.phase = 1;
        armor.data.vCrack = sim.time; // v2.85 — только рисунок
        sim.events.push({
          t: 'boss',
          what: 'phase',
          text: 'ЛАТЫ ТРЕЩАТ',
          sub: 'из щелей сыплется рой',
        });
      }
      return;
    }
    if (stage === 1) {
      b.data.swarmT -= dt;
      if (b.data.swarmT <= 0) startGather(sim, b);
      return;
    }
    if (stage === 2) {
      b.data.gatherT += dt;
      if (b.data.gatherT >= GATHER_T) reform(sim, b, api);
    }
  },
  onPartDown(sim, b, m, api) {
    if (m.kind === F2_ARMOR) {
      burst(sim, b, m, api);
      return true;
    }
    if (m.kind !== F2_MITE) return false;
    if (sim.mobs.some((x) => x.kind === F2_ARMOR && x.mode !== 'dying')) return true;
    if (aliveMites(sim).some((x) => x !== m)) return true;
    // Последний латник снаружи. Кто-то уже внутри — латы встают сразу.
    if ((b.data.inside ?? 0) > 0) {
      reform(sim, b, api);
      return true;
    }
    // Рой добит: обломки падают замертво, клинок звенит об пол.
    for (const x of sim.mobs)
      if (x.kind === F2_PLATE || x.kind === F2_BLADE) {
        x.mode = 'dying';
        x.t = 0;
        x.tele = null;
      }
    sim.strikes = [];
    b.data.stage = 3;
    return false;
  },
  bar(sim, b) {
    const stage = b.data.stage ?? 0;
    let mites = aliveMites(sim).length;
    if (stage === 0) mites += b.data.mites ?? 0;
    if (stage === 2) mites += b.data.inside ?? 0;
    const swarm = (1 - W_ARM) * Math.min(1, mites / MITES0);
    if (stage === 0) {
      const armor = sim.mobs.find((x) => x.kind === F2_ARMOR && x.mode !== 'dying');
      return swarm + (armor ? (W_ARM * Math.max(0, armor.hp)) / armor.maxHp : 0);
    }
    if (stage === 2) {
      // Сборка: полоса растёт на глазах — латы набирают здоровье.
      const k = Math.min(1, (b.data.gatherT ?? 0) / GATHER_T);
      const inside = (b.data.inside ?? 0) + aliveMites(sim).length;
      return swarm + W_ARM * reformShare(inside) * k;
    }
    return swarm;
  },
  reset(sim) {
    sim.mobs = sim.mobs.filter((x) => x.kind !== F2_PLATE && x.kind !== F2_BLADE);
  },
});
