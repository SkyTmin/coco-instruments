// Этаж 10 «Трон демона» — ИИ монстров, сценарий Короля демонов и правила
// этажа.
//
// Правила этажа (`registerFloor(10)`):
//   • ПОСТЫ. Стражи (`1`), рыцари (`5`), палач (`3`), горгульи на
//     постаментах (`2`) и псы на цепях у столбов псарни ставятся сценарием,
//     когда герой подходит, — и стоят на местах, как караул, а не бегут из
//     нор. Убитый не встаёт до конца вылазки;
//   • ШИПЫ ВРАТ. Ряды шипов в проходе Врат поднимаются волной по кругу:
//     метка за 0,6 с, удар, шипы стоят 0,7 с. Между рядами — ковёр,
//     на нём безопасно: пройти можно в ритме;
//   • МОСТ (зал-событие Врат). Прошёл ветхий пролёт — доски за спиной
//     трещат и падают в бездну, а с того берега скачут два рыцаря ада. На
//     прямом мосту рыцарь, промахнувшись, улетает в пролом. Когда рыцари
//     кончились, цепи подтягивают доски обратно;
//   • ГРОЗА (зал-событие Галереи). Вошёл в Витражный зал — за окнами
//     бьёт гроза: молнии падают на пол полосами и клетками с метками,
//     стёкла сыплются у северной стены, маги выходят на вспышки. Отстоял —
//     окна выбиты, на полу награда;
//   • СОКРОВИЩНИЦА (зал-ловушка Тронного зала). Открыл сундук — решётка
//     падает на дверь, горгульи на постаментах оживают по очереди.
//     Решётка поднимается, когда горгулий не осталось.
//
// Честность: всё, что бьёт, видно заранее — конус алебарды, линия
// выпада и тарана, кольцо цепа, метка прыжка, метки молний, метка пике,
// трещины перед обвалом.
//
// Движок сюда не импортируется значениями (круг модулей) — только `api`.

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi, ZoneIn } from '../dungeon-ai';
import type { BossFight, Mob, Prop, Sim } from '../dungeon-sim';
import { F10_GATES, F10_MARK } from './f10';

const TAU = Math.PI * 2;
const hypot = Math.hypot;

// Клетки мира (копия `Tile` из `dungeon-world.ts`: значениями движок не
// импортируется).
const T_WALL = 1;
const T_FLOOR = 2;
const T_DEEP = 11;

// ---------------------------------------------------------------------------
// Общее.
// ---------------------------------------------------------------------------

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';

const markAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 0;
  return w.mark[y * w.w + x];
};

const tileAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return T_WALL;
  return sim.tiles[y * w.w + x];
};

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
};

/** Урон, который после брони героя станет долей его здоровья. */
const rawShare = (sim: Sim, share: number) =>
  (sim.stats.maxHp * share * (100 + Math.max(0, sim.stats.armor))) / 100;

/** Задевает ли линия (из точки по углу, длина, полуширина) круг героя. */
function lineHits(
  x: number,
  y: number,
  ang: number,
  len: number,
  w: number,
  hx: number,
  hy: number,
  hr: number,
): boolean {
  const dx = hx - x;
  const dy = hy - y;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const along = dx * ux + dy * uy;
  const across = Math.abs(-dx * uy + dy * ux);
  return along > -hr && along < len + hr && across < w + hr;
}

/** Сколько клеток до преграды (стена или пропасть) по направлению. */
function clearDist(sim: Sim, api: SimApi, x: number, y: number, ang: number, max: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.2; d <= max; d += 0.2)
    if (api.solidTile(sim, Math.floor(x + ux * d), Math.floor(y + uy * d))) return d;
  return max + 1;
}

/** Прямая от точки до точки идёт только по полу (без стен и пропасти). */
function clearLine(sim: Sim, api: SimApi, ax: number, ay: number, bx: number, by: number): boolean {
  const d = hypot(bx - ax, by - ay);
  const n = Math.ceil(d * 3);
  for (let i = 1; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n;
    const y = ay + ((by - ay) * i) / n;
    if (api.solidTile(sim, Math.floor(x), Math.floor(y))) return false;
  }
  return true;
}

/** Попал ли удар вплотную: рывок и неуязвимость спасают. */
const canHurt = (sim: Sim) => sim.hero.inv <= 0 && sim.hero.mode !== 'dash' && !heroDown(sim);

/** Отдых после удара: гасит скорость, потом снова в погоню. */
function recoverStep(m: Mob, api: SimApi, T: number, next = 'chase'): void {
  m.vx *= 0.8;
  m.vy *= 0.8;
  m.tele = null;
  m.danger = 0;
  if (m.t > T) api.setMode(m, next);
}

/** Точка пола рядом с (x, y) на расстоянии `r0…r1`, дальняя от героя. */
function spotAway(
  sim: Sim,
  api: SimApi,
  x: number,
  y: number,
  r0: number,
  r1: number,
  from: { x: number; y: number },
): [number, number] | null {
  let best: [number, number] | null = null;
  let bs = -1e9;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU + sim.rng() * 0.2;
    const r = r0 + sim.rng() * (r1 - r0);
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    if (api.solidTile(sim, cx, cy)) continue;
    // Не впритык к стене: тело должно встать.
    if (
      api.solidTile(sim, cx + 1, cy) ||
      api.solidTile(sim, cx - 1, cy) ||
      api.solidTile(sim, cx, cy + 1) ||
      api.solidTile(sim, cx, cy - 1)
    )
      continue;
    const s = hypot(cx + 0.5 - from.x, cy + 0.5 - from.y) + sim.rng() * 0.5;
    if (s > bs) {
      bs = s;
      best = [cx + 0.5, cy + 0.5];
    }
  }
  return best;
}

/** Общий черновик визуала для рисовальщика (кадр — один мир на экране). */
export const F10_FX = {
  /** Вспышка молнии в окнах до этого времени сцены (в секундах `performance`). */
  storm: 0,
};

// ---------------------------------------------------------------------------
// Адский пёс: стая, прыжок-укус с ожогом; у псарни — на цепи.
// ---------------------------------------------------------------------------

const POUNCE = { aim: 0.45, speed: 10, max: 3.6 };

/** Пёс на цепи: не дальше длины цепи от столба. */
function leash(m: Mob): void {
  if (!m.data.chain) return;
  const px = m.data.px;
  const py = m.data.py;
  const L = m.data.len;
  const dx = m.x - px;
  const dy = m.y - py;
  const d = hypot(dx, dy);
  if (d > L) {
    m.x = px + (dx / d) * L;
    m.y = py + (dy / d) * L;
    // Натянул цепь — скорость наружу гаснет.
    const out = (m.vx * dx + m.vy * dy) / d;
    if (out > 0) {
      m.vx -= (dx / d) * out;
      m.vy -= (dy / d) * out;
    }
    const kout = (m.kx * dx + m.ky * dy) / d;
    if (kout > 0) {
      m.kx -= (dx / d) * kout;
      m.ky -= (dy / d) * kout;
    }
  }
}

/** Куда может дотянуться пёс на цепи (для прыжка): точка на цепи ближе к цели. */
function chainReach(m: Mob, tx: number, ty: number): [number, number] {
  if (!m.data.chain) return [tx, ty];
  const dx = tx - m.data.px;
  const dy = ty - m.data.py;
  const d = hypot(dx, dy);
  const L = m.data.len;
  if (d <= L) return [tx, ty];
  return [m.data.px + (dx / d) * L, m.data.py + (dy / d) * L];
}

registerBrain('f10_hound', {
  step(sim, m, dt, c, api) {
    leash(m);
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    const chained = !!m.data.chain;
    // Сколько можно дотянуться до героя на цепи.
    const hd = chained ? hypot(h.x - m.data.px, h.y - m.data.py) : 0;
    const inReach = !chained || hd < m.data.len + def.reach + m.r + h.r + 0.2;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (chained && !inReach) {
          // Рвётся с цепи к герою, стоит на её конце и лает.
          const [tx, ty] = chainReach(m, h.x, h.y);
          const ex = tx - m.x;
          const ey = ty - m.y;
          const ed = hypot(ex, ey);
          if (ed > 0.3) api.steer(sim, m, ex / ed, ey / ed, m.speed * 0.8, dt);
          else {
            m.vx *= 0.7;
            m.vy *= 0.7;
            m.face = Math.atan2(dy, dx);
          }
          if (hd < m.data.len + 4 && sim.rng() < dt * 0.6)
            sim.events.push({ t: 'squeak', x: m.x, y: m.y });
          return;
        }
        // Прыжок — по очереди: пока прыгает сосед, этот обходит.
        const busy = sim.mobs.some(
          (o) =>
            o !== m &&
            o.kind === 'f10_hound' &&
            (o.mode === 'aim' || o.mode === 'pounce') &&
            hypot(o.x - m.x, o.y - m.y) < 7,
        );
        if (
          see &&
          dist > 1.5 &&
          dist < POUNCE.max &&
          m.cd <= 0 &&
          !busy &&
          clearLine(sim, api, m.x, m.y, h.x, h.y)
        ) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        // Стая кружит: точка на кольце вокруг героя, у каждого своя сторона.
        const side = m.id % 2 ? 1 : -1;
        const a0 = Math.atan2(m.y - h.y, m.x - h.x) + side * 0.7;
        const R = dist > 7 ? 0 : 2.6;
        const [cx, cy] = api.chaseDir(sim, m, h.x + Math.cos(a0) * R, h.y + Math.sin(a0) * R);
        api.steer(sim, m, cx, cy, m.speed * (dist < 2.6 ? 0.7 : 1), dt);
        return;
      }
      case 'aim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < POUNCE.aim * 0.55) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        let len = Math.min(
          POUNCE.max + 0.6,
          clearDist(sim, api, m.x, m.y, m.dir, POUNCE.max + 0.6),
        );
        if (chained) {
          const [tx, ty] = chainReach(m, m.x + Math.cos(m.dir) * len, m.y + Math.sin(m.dir) * len);
          len = Math.min(len, hypot(tx - m.x, ty - m.y));
        }
        m.data.len2 = len;
        m.tele = { shape: 'line', r: len, w: 0.32, ang: m.dir, k: Math.min(1, m.t / POUNCE.aim) };
        if (m.t > POUNCE.aim - 0.22) m.danger = len + 0.6;
        if (m.t >= POUNCE.aim) {
          m.data.hit = 0;
          m.data.run = 0;
          api.setMode(m, 'pounce');
          sim.events.push({ t: 'squeak', x: m.x, y: m.y });
        }
        return;
      }
      case 'pounce': {
        const s = POUNCE.speed;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.data.run += s * dt;
        m.danger = m.r + h.r + 0.8;
        if (!m.data.hit && dist < m.r + h.r + 0.18 && canHurt(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.15, m.x, m.y, 3.5, m.kind, { kind: 'burn', dur: 1.2 });
        }
        if (m.data.run >= (m.data.len2 ?? POUNCE.max) || m.t > 0.6) {
          if (chained) sim.events.push({ t: 'clank', x: m.x, y: m.y });
          api.setMode(m, 'recover');
          m.cd = 2.2 + sim.rng() * 1.2;
        }
        return;
      }
      case 'windup': {
        m.vx *= 0.75;
        m.vy *= 0.75;
        if (m.t > def.windup - 0.2) m.danger = def.reach + m.r + h.r + 0.4;
        if (m.t < def.windup) return;
        if (dist < def.reach + m.r + h.r + 0.18 && canHurt(sim))
          api.hurtHero(sim, m.dmg, m.x, m.y, 2.2, m.kind, { kind: 'burn', dur: 0.8 });
        m.vx += Math.cos(m.face) * 3;
        m.vy += Math.sin(m.face) * 3;
        api.setMode(m, 'recover');
        m.data.bcd = def.rest * (0.8 + sim.rng() * 0.4);
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.55);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m) {
    if (m.data.post !== undefined) killPost(sim, m.data.post);
  },
});

// ---------------------------------------------------------------------------
// Демон-страж: алебарда — широкий взмах конусом, выпад линией. Стоит на
// посту, пока не увидит.
// ---------------------------------------------------------------------------

export const GUARD = { sweepR: 2.4, sweepArc: 2.1, sweepWarn: 0.8, thrustR: 3.4, thrustWarn: 0.66 };

/** Караульный на посту: стоит лицом на юг, просыпается от героя или удара. */
function postWatch(
  sim: Sim,
  m: Mob,
  dt: number,
  c: BrainCtx,
  api: SimApi,
  see: number,
  near: number,
): boolean {
  if (m.mode !== 'f10_stand') return false;
  m.vx *= 0.6;
  m.vy *= 0.6;
  m.tele = null;
  m.danger = 0;
  // Стоит на посту: толкнули — возвращается.
  const bx = (m.data.hx ?? m.x) - m.x;
  const by = (m.data.hy ?? m.y) - m.y;
  if (hypot(bx, by) > 0.3) api.steer(sim, m, bx, by, m.speed * 0.5, dt);
  else m.face = Math.PI / 2;
  const h = sim.hero;
  const hit = m.hp < m.maxHp;
  if (
    hit ||
    c.dist < near ||
    (c.dist < see && api.lineOfSight(sim, m.x, m.y, h.x, h.y) && !heroDown(sim))
  ) {
    api.setMode(m, 'alertpost');
    m.face = Math.atan2(c.dy, c.dx);
    sim.events.push({ t: 'squeak', x: m.x, y: m.y });
  }
  return true;
}

registerBrain('f10_guard', {
  step(sim, m, dt, c, api) {
    if (postWatch(sim, m, dt, c, api, 6, 2.6)) return;
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    m.data.thCd = (m.data.thCd ?? 0) - dt;
    switch (m.mode) {
      case 'alertpost':
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(dy, dx);
        if (m.t > 0.45) api.setMode(m, 'chase');
        return;
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (m.cd <= 0 && see) {
          if (dist < GUARD.sweepR - 0.4) {
            m.dir = Math.atan2(dy, dx);
            api.setMode(m, 'sweep');
            return;
          }
          if (dist < GUARD.thrustR - 0.2 && m.data.thCd <= 0) {
            m.dir = Math.atan2(dy, dx);
            api.setMode(m, 'thrust');
            return;
          }
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * (dist < 1.6 ? 0.4 : 1), dt);
        return;
      }
      case 'sweep': {
        // Замах: алебарда уходит за плечо, конус наливается. Первую
        // четверть доводит лезвие до героя, потом уже не свернёт.
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < 0.22) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        if (!m.data.lit && m.t >= 0.22) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'cone',
            x: m.x,
            y: m.y,
            r: GUARD.sweepR,
            ang: m.dir,
            arc: GUARD.sweepArc,
            warn: GUARD.sweepWarn - 0.22,
            dmg: m.dmg * 1.4,
            knock: 6,
            art: 'f10_sweep',
            from: m.id,
          });
        }
        if (m.t > GUARD.sweepWarn - 0.26) m.danger = GUARD.sweepR + 0.4;
        if (m.t >= GUARD.sweepWarn) {
          m.data.lit = 0;
          sim.events.push({ t: 'boss', what: 'whip' });
          api.setMode(m, 'recover');
          m.cd = 1.1 + sim.rng() * 0.6;
        }
        return;
      }
      case 'thrust': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < 0.2) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(GUARD.thrustR, clearDist(sim, api, m.x, m.y, m.dir, GUARD.thrustR));
        if (!m.data.lit && m.t >= 0.2) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: len,
            w: 0.36,
            ang: m.dir,
            warn: GUARD.thrustWarn - 0.2,
            dmg: m.dmg * 1.25,
            knock: 5,
            art: 'f10_thrust',
            from: m.id,
          });
        }
        if (m.t > GUARD.thrustWarn - 0.24) m.danger = len + 0.5;
        if (m.t >= GUARD.thrustWarn) {
          m.data.lit = 0;
          // Выпад — шаг вперёд вслед за алебардой.
          m.vx += Math.cos(m.dir) * 4;
          m.vy += Math.sin(m.dir) * 4;
          api.setMode(m, 'recover');
          m.cd = 0.9 + sim.rng() * 0.5;
          m.data.thCd = 3;
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.85);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m) {
    if (m.data.post !== undefined) killPost(sim, m.data.post);
  },
});

// ---------------------------------------------------------------------------
// Рыцарь ада на коне: прицел линией до преграды, таран. Упёрся в стену —
// оглушён; проскочил край моста — летит в пропасть.
// ---------------------------------------------------------------------------

export const KNIGHT = { aim: 0.95, speed: 12, max: 11, dizzy: 1.8, lanceWarn: 0.55 };

/** Клетка впереди по ходу — пропасть? */
function deepAhead(sim: Sim, m: Mob): boolean {
  const ux = Math.cos(m.dir);
  const uy = Math.sin(m.dir);
  for (const k of [m.r + 0.15, m.r + 0.45]) {
    const x = Math.floor(m.x + ux * k);
    const y = Math.floor(m.y + uy * k);
    if (tileAt(sim, x, y) === T_DEEP) return true;
  }
  return false;
}

function knightFall(sim: Sim, m: Mob, api: SimApi): void {
  m.bounce = false;
  m.danger = 0;
  m.tele = null;
  m.data.ghost = 1;
  m.data.fx = Math.cos(m.dir);
  m.data.fy = Math.sin(m.dir);
  api.setMode(m, 'f10_fall');
  sim.events.push({
    t: 'boss',
    what: 'f10_fall',
    text: 'В БЕЗДНУ!',
    sub: 'рыцарь ада проскочил край',
  });
}

registerBrain('f10_knight', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'f10_patrol': {
        // На посту: конь переминается, всадник смотрит вдоль моста.
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.data.look ?? 0;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (m.hp < m.maxHp || (see && dist < 9 && !heroDown(sim))) {
          api.setMode(m, 'chase');
          m.cd = 0.3;
        }
        return;
      }
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (dist < 1.8 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'lance');
          return;
        }
        if (
          see &&
          dist > 2.2 &&
          dist < KNIGHT.max - 1 &&
          m.cd <= 0 &&
          clearLine(sim, api, m.x, m.y, h.x, h.y)
        ) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'aim': {
        // Конь роет копытом, всадник опускает копьё: видно, куда поскачет.
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < KNIGHT.aim * 0.55) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(KNIGHT.max, clearDist(sim, api, m.x, m.y, m.dir, KNIGHT.max));
        m.tele = {
          shape: 'line',
          r: len + m.r * 0.5,
          w: m.r * 0.9,
          ang: m.dir,
          k: Math.min(1, m.t / KNIGHT.aim),
        };
        if (m.t > KNIGHT.aim - 0.26) m.danger = 4.6;
        if (m.t >= KNIGHT.aim) {
          m.data.hit = 0;
          m.data.run = 0;
          m.bounce = true;
          api.setMode(m, 'charge');
          sim.events.push({ t: 'boss', what: 'roll' });
        }
        return;
      }
      case 'charge': {
        const s = KNIGHT.speed;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.data.run += s * dt;
        m.danger = m.r + h.r + 1.2;
        if (!m.data.hit && dist < m.r + h.r + 0.1 && canHurt(sim)) {
          // Сшиб — и скачет дальше: остановит его только преграда.
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.5, m.x, m.y, 10, m.kind);
        }
        if (deepAhead(sim, m)) {
          knightFall(sim, m, api);
          return;
        }
        if (m.data.run >= KNIGHT.max || m.t > 1.6) {
          m.bounce = false;
          api.setMode(m, 'skid');
        }
        return;
      }
      case 'skid':
        // Не достал преграды — осадил коня: короткое окно.
        m.vx *= 0.86;
        m.vy *= 0.86;
        if (deepAhead(sim, m) && hypot(m.vx, m.vy) > 3) {
          knightFall(sim, m, api);
          return;
        }
        if (m.t > 0.7) {
          api.setMode(m, 'recover');
          m.cd = 0.8;
        }
        return;
      case 'dizzy':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > KNIGHT.dizzy) {
          api.setMode(m, 'chase');
          m.cd = 0.5;
        }
        return;
      case 'lance': {
        // Вплотную — укол копьём с седла: короткая линия.
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < 0.2) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = {
          shape: 'line',
          r: 2.1,
          w: 0.34,
          ang: m.dir,
          k: Math.min(1, m.t / KNIGHT.lanceWarn),
        };
        if (m.t > KNIGHT.lanceWarn - 0.22) m.danger = 2.6;
        if (m.t >= KNIGHT.lanceWarn) {
          if (canHurt(sim) && lineHits(m.x, m.y, m.dir, 2.1, 0.34, h.x, h.y, h.r))
            api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind);
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.9 + sim.rng() * 0.4);
        }
        return;
      }
      case 'f10_fall': {
        // Конь с всадником уходят вниз: 0,9 с — и нет их.
        m.data.ghost = 1;
        m.vx = m.data.fx * 3 * Math.max(0, 1 - m.t * 2);
        m.vy = m.data.fy * 3 * Math.max(0, 1 - m.t * 2);
        if (m.t > 0.9) {
          // Подкова осталась на краю — трофей за хитрость.
          const ex = m.x - m.data.fx * 1.2;
          const ey = m.y - m.data.fy * 1.2;
          if (sim.rng() < 0.6) api.dropAt(sim, 'f10_shoe', 1, ex, ey);
          api.dropAt(sim, 'coin', 80, ex, ey);
          m.hp = 0;
          api.setMode(m, 'escape');
          sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.6);
        return;
      default:
        m.bounce = false;
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'charge') return;
    if (deepAhead(sim, m)) {
      knightFall(sim, m, api);
      return;
    }
    // Врезался в кладку — конь встал на дыбы, всадник оглушён.
    m.bounce = false;
    m.vx = 0;
    m.vy = 0;
    m.danger = 0;
    sim.hitstop = Math.max(sim.hitstop, 0.07);
    sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
    sim.events.push({ t: 'boss', what: 'f10_knight_wall' });
    api.setMode(m, 'dizzy');
  },
  onHit(_sim, m) {
    // Падающего не достать; оглушённый о стену — открыт.
    if (m.mode === 'f10_fall') return 0;
    return m.mode === 'dizzy' ? 1.35 : 1;
  },
  onDeath(sim, m) {
    if (m.data.post !== undefined) killPost(sim, m.data.post);
  },
});

// ---------------------------------------------------------------------------
// Суккуба: висит поодаль (над пропастью — охотнее), поцелуй-сердце
// очаровывает; очарованного — налёт когтями.
// ---------------------------------------------------------------------------

export const SUCC = { far: 4.4, near: 3.2, kiss: 0.62, shot: 5.6, swoopAim: 0.38, swoop: 9 };

/** Где зависнуть: кольцо вокруг героя, пропасть под собой — плюс. */
function hoverSpot(sim: Sim, api: SimApi, m: Mob): [number, number] {
  const h = sim.hero;
  let best: [number, number] = [m.x, m.y];
  let bs = -1e9;
  const R = (SUCC.far + SUCC.near) / 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + m.id;
    const x = h.x + Math.cos(a) * R;
    const y = h.y + Math.sin(a) * R;
    const t = tileAt(sim, Math.floor(x), Math.floor(y));
    if (t !== T_DEEP && api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
    if (!api.lineOfSight(sim, x, y, h.x, h.y)) continue;
    let s = -hypot(x - m.x, y - m.y) * 0.5;
    if (t === T_DEEP) s += 3;
    if (s > bs) {
      bs = s;
      best = [x, y];
    }
  }
  return best;
}

registerBrain('f10_succubus', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    const charmed = (h.status.charm?.t ?? 0) > 0;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        // Очарован — налёт.
        if (charmed && see && dist < 6.5 && (m.data.swCd ?? -1) <= sim.time) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'swoopAim');
          return;
        }
        if (see && dist < SUCC.shot + 0.8 && dist > 1.8 && m.cd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'kiss');
          return;
        }
        if (dist < 1.3 && (m.data.clCd ?? -1) <= sim.time) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'claw');
          return;
        }
        // Парит: держит дистанцию, над пропастью — охотнее.
        if (!m.data.ht || sim.time > m.data.ht) {
          const [tx, ty] = hoverSpot(sim, api, m);
          m.data.tx = tx;
          m.data.ty = ty;
          m.data.ht = sim.time + 1.2 + sim.rng();
        }
        const ex = m.data.tx - m.x;
        const ey = m.data.ty - m.y;
        const ed = hypot(ex, ey);
        if (ed > 0.4 && dist < 9) {
          // Летит напрямую (над пропастью), сквозь стены — по полю.
          let [cx, cy] = [ex / ed, ey / ed];
          if (!api.lineOfSight(sim, m.x, m.y, m.data.tx, m.data.ty))
            [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
          const w = Math.sin(sim.time * 3 + m.id) * 0.4;
          api.steer(sim, m, cx - cy * w, cy + cx * w, m.speed, dt);
        } else if (dist >= 9) {
          const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
          api.steer(sim, m, cx, cy, m.speed, dt);
        } else {
          m.vx *= 0.9;
          m.vy *= 0.9;
        }
        m.face = Math.atan2(dy, dx);
        return;
      }
      case 'kiss': {
        // Воздушный поцелуй: сердце летит медленно — видно, увернуться.
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t < SUCC.kiss * 0.6) m.face = Math.atan2(dy, dx);
        m.tele = {
          shape: 'line',
          r: SUCC.shot,
          w: 0.22,
          ang: m.face,
          k: Math.min(1, m.t / SUCC.kiss),
        };
        if (m.t >= SUCC.kiss) {
          api.shoot(sim, m, m.face, {
            speed: 5.6,
            r: 0.3,
            life: SUCC.shot / 5.6,
            dmg: 0.45,
            art: 'f10_heart',
            status: 'charm',
            dur: 1.2,
          });
          api.setMode(m, 'linger');
          m.cd = 3.2 + sim.rng() * 1.2;
        }
        return;
      }
      case 'linger':
        // После поцелуя — смеётся, висит на месте: окно для ответа.
        m.vx *= 0.85;
        m.vy *= 0.85;
        m.face = Math.atan2(dy, dx);
        if (m.t > 0.9) api.setMode(m, 'chase');
        return;
      case 'swoopAim': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < SUCC.swoopAim * 0.6) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = {
          shape: 'line',
          r: Math.min(6.5, dist + 1),
          w: 0.36,
          ang: m.dir,
          k: Math.min(1, m.t / SUCC.swoopAim),
        };
        if (m.t > SUCC.swoopAim - 0.2) m.danger = dist + 1;
        if (m.t >= SUCC.swoopAim) {
          m.data.hit = 0;
          api.setMode(m, 'swoop');
        }
        return;
      }
      case 'swoop': {
        m.vx = Math.cos(m.dir) * SUCC.swoop;
        m.vy = Math.sin(m.dir) * SUCC.swoop;
        m.face = m.dir;
        m.danger = m.r + h.r + 0.8;
        if (!m.data.hit && dist < m.r + h.r + 0.25 && canHurt(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.3, m.x, m.y, 4, m.kind);
        }
        if (m.t > 0.75 || (m.data.hit && m.t > 0.25)) {
          m.data.swCd = sim.time + 4;
          api.setMode(m, 'linger');
        }
        return;
      }
      case 'claw': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        const T = 0.5;
        m.face = m.t < 0.15 ? Math.atan2(dy, dx) : m.face;
        m.tele = {
          shape: 'cone',
          r: def.reach + m.r + 0.7,
          arc: 1.7,
          ang: m.face,
          k: Math.min(1, m.t / T),
        };
        if (m.t > T - 0.2) m.danger = 1.8;
        if (m.t >= T) {
          const off = Math.abs(angDiff(Math.atan2(dy, dx), m.face));
          if (dist < def.reach + m.r + h.r + 0.5 && off < 1 && canHurt(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, 3, m.kind);
          m.data.clCd = sim.time + 2;
          api.setMode(m, 'linger');
        }
        return;
      }
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Горгулья: камень на постаменте (недосягаема), оживает, когда подходишь;
// прыжок на героя с меткой приземления; раненая каменеет и затягивает
// трещины.
// ---------------------------------------------------------------------------

export const GARG = {
  wakeR: 2.8,
  wake: 0.85,
  leap: 0.8,
  leapR: 1.2,
  clawWarn: 0.6,
  stone: 3.2,
  heal: 0.18,
};

function startLeap(sim: Sim, m: Mob, api: SimApi, tx: number, ty: number): void {
  m.data.lx0 = m.x;
  m.data.ly0 = m.y;
  m.data.lx1 = tx;
  m.data.ly1 = ty;
  m.data.z = 0;
  m.face = Math.atan2(ty - m.y, tx - m.x);
  api.setMode(m, 'leap');
  api.strike(sim, {
    shape: 'circle',
    x: tx,
    y: ty,
    r: GARG.leapR,
    warn: GARG.leap,
    dmg: m.dmg * 1.3,
    knock: 7,
    art: 'f10_land',
    from: m.id,
  });
}

registerBrain('f10_gargoyle', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.leapCd = (m.data.leapCd ?? 1.5) - dt;
    switch (m.mode) {
      case 'f10_stone': {
        // Статуя на постаменте: не шелохнётся, удар не берёт.
        m.data.ghost = 1;
        m.vx = 0;
        m.vy = 0;
        m.x = m.data.hx ?? m.x;
        m.y = m.data.hy ?? m.y;
        m.face = Math.PI / 2;
        const woke = (m.data.wakeAt ?? 0) > 0 && sim.time >= m.data.wakeAt;
        if (
          woke ||
          (!heroDown(sim) &&
            m.data.wakeAt === undefined &&
            dist < GARG.wakeR &&
            api.lineOfSight(sim, m.x, m.y, h.x, h.y))
        ) {
          api.setMode(m, 'f10_wake');
          sim.events.push({ t: 'boss', what: 'f10_garg_wall' });
        }
        return;
      }
      case 'f10_wake': {
        // Камень трескается, сыплется крошка, глаза загораются.
        m.vx = 0;
        m.vy = 0;
        m.face = Math.atan2(dy, dx);
        m.data.ghost = m.t < GARG.wake * 0.6 ? 1 : 0;
        m.tele = { shape: 'ring', r: 0.9, w: 0.1, k: Math.min(1, m.t / GARG.wake) };
        if (m.t >= GARG.wake) {
          m.data.ghost = 0;
          delete m.data.hx;
          delete m.data.hy;
          if (dist > 1.6 && dist < 6 && clearLine(sim, api, m.x, m.y, h.x, h.y))
            startLeap(sim, m, api, h.x, h.y);
          else api.setMode(m, 'chase');
        }
        return;
      }
      case 'leap': {
        // Прыжок дугой: метка приземления горит всё время полёта.
        const k = Math.min(1, m.t / GARG.leap);
        m.x = m.data.lx0 + (m.data.lx1 - m.data.lx0) * k;
        m.y = m.data.ly0 + (m.data.ly1 - m.data.ly0) * k;
        m.vx = 0;
        m.vy = 0;
        m.data.z = Math.sin(k * Math.PI) * 1.4;
        m.data.ghost = k > 0.15 && k < 0.85 ? 1 : 0;
        if (k >= 1) {
          m.data.z = 0;
          m.data.ghost = 0;
          m.data.leapCd = 4.5 + sim.rng() * 2;
          sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'chase': {
        if (!m.data.stoned && m.hp < m.maxHp * 0.35) {
          m.data.stoned = 1;
          api.setMode(m, 'f10_petrify');
          sim.events.push({
            t: 'boss',
            what: 'f10_stone',
            text: 'КАМЕНЬ',
            sub: 'горгулья затягивает раны',
          });
          return;
        }
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (
          see &&
          dist > 2.6 &&
          dist < 6.5 &&
          m.data.leapCd <= 0 &&
          clearLine(sim, api, m.x, m.y, h.x, h.y)
        ) {
          startLeap(sim, m, api, h.x, h.y);
          return;
        }
        if (dist < def.reach + m.r + h.r + 0.4 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'claw');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * (dist < 1.6 ? 0.5 : 1), dt);
        return;
      }
      case 'claw': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < 0.18) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        if (!m.data.lit && m.t >= 0.18) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'cone',
            x: m.x,
            y: m.y,
            r: 1.75,
            ang: m.dir,
            arc: 1.9,
            warn: GARG.clawWarn - 0.18,
            dmg: m.dmg * 1.1,
            knock: 4,
            art: 'f10_claws',
            from: m.id,
          });
        }
        if (m.t > GARG.clawWarn - 0.24) m.danger = 2.2;
        if (m.t >= GARG.clawWarn) {
          m.data.lit = 0;
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      }
      case 'f10_petrify': {
        // Каменеет: удары не берут, трещины на глазах затягиваются.
        m.data.ghost = 1;
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.hp = Math.min(m.maxHp, m.hp + ((m.maxHp * GARG.heal) / GARG.stone) * dt);
        m.tele = { shape: 'ring', r: 1.2, w: 0.12, k: Math.min(1, m.t / GARG.stone) };
        if (m.t >= GARG.stone) {
          m.data.ghost = 0;
          // Из камня — сразу прыжком.
          if (dist > 1.6 && dist < 6.5 && clearLine(sim, api, m.x, m.y, h.x, h.y))
            startLeap(sim, m, api, h.x, h.y);
          else api.setMode(m, 'chase');
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.85);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m) {
    if (m.data.post !== undefined) killPost(sim, m.data.post);
  },
});

// ---------------------------------------------------------------------------
// Архидемон-маг: молнии по клеткам с метками, «цепь» по линии, печать на
// герое; подойдёшь — уходит вспышкой (метка — куда).
// ---------------------------------------------------------------------------

export const MAGE = { cast: 1.05, boltWarn: 1.05, chainWarn: 0.85, blinkT: 0.55, keep: [3.6, 6.2] };

function mageCast(sim: Sim, m: Mob, api: SimApi): void {
  const h = sim.hero;
  const kind = (m.data.spell ?? 0) % 3;
  m.data.spell = (m.data.spell ?? 0) + 1;
  const dmg = m.dmg * 1.3;
  if (kind === 0) {
    // Три молнии: на героя и по бокам — уходить вперёд или назад.
    const a = Math.atan2(h.y - m.y, h.x - m.x) + Math.PI / 2;
    for (const off of [0, 1.7, -1.7]) {
      const x = h.x + Math.cos(a) * off;
      const y = h.y + Math.sin(a) * off;
      if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
      api.strike(sim, {
        shape: 'circle',
        x,
        y,
        r: 0.8,
        warn: MAGE.boltWarn,
        dmg,
        knock: 3,
        art: 'f10_bolt',
        from: m.id,
      });
    }
  } else if (kind === 1) {
    // Цепь: молнии катятся по линии от мага к герою и дальше.
    const a = Math.atan2(h.y - m.y, h.x - m.x);
    for (let i = 1; i <= 6; i++) {
      const x = m.x + Math.cos(a) * i * 1.25;
      const y = m.y + Math.sin(a) * i * 1.25;
      if (api.solidTile(sim, Math.floor(x), Math.floor(y))) break;
      api.strike(sim, {
        shape: 'circle',
        x,
        y,
        r: 0.72,
        warn: MAGE.chainWarn + i * 0.11,
        dmg,
        knock: 3,
        art: 'f10_bolt',
        from: m.id,
      });
    }
  } else {
    // Печать: знак прилипает к герою, потом отстаёт и бьёт там, где остался.
    const z: ZoneIn & { follow: number; mob: number } = {
      x: h.x,
      y: h.y,
      r: 1,
      life: 1.35,
      art: 'f10_sigil',
      follow: 1,
      mob: m.id,
    };
    api.zone(sim, z);
  }
}

registerBrain('f10_mage', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    m.data.blCd = (m.data.blCd ?? 1) - dt;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (dist < 1.9 && m.data.blCd <= 0) {
          const to = spotAway(sim, api, m.x, m.y, 4, 6, h);
          if (to) {
            m.data.bx = to[0];
            m.data.by = to[1];
            api.setMode(m, 'blink');
            api.zone(sim, {
              x: to[0],
              y: to[1],
              r: 0.7,
              life: MAGE.blinkT + 0.1,
              art: 'f10_blinkmark',
            });
            return;
          }
        }
        if (see && dist < 7 && m.cd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'cast');
          return;
        }
        // Держит дистанцию: близко — отходит, далеко — подходит.
        let dir: [number, number];
        if (dist < MAGE.keep[0] && see)
          dir = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
        else dir = api.chaseDir(sim, m, h.x, h.y);
        const k = dist > MAGE.keep[0] && dist < MAGE.keep[1] && see ? 0.25 : 1;
        api.steer(sim, m, dir[0], dir[1], m.speed * k, dt);
        m.face = Math.atan2(dy, dx);
        return;
      }
      case 'cast': {
        // Посох вверх, руна над головой наливается; метки — в миг каста.
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(dy, dx);
        if (!m.data.lit && m.t >= 0.35) {
          m.data.lit = 1;
          mageCast(sim, m, api);
        }
        if (m.t >= MAGE.cast) {
          m.data.lit = 0;
          api.setMode(m, 'recover');
          m.cd = 2.4 + sim.rng() * 1.2;
        }
        return;
      }
      case 'blink': {
        // Сжимается в точку: 0,55 с на месте — окно ударить.
        m.vx *= 0.5;
        m.vy *= 0.5;
        if (m.t >= MAGE.blinkT) {
          m.x = m.data.bx;
          m.y = m.data.by;
          m.vx = 0;
          m.vy = 0;
          m.data.blCd = 5;
          sim.events.push({ t: 'emerge', x: m.x, y: m.y });
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 1.05);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Палач: цепной цеп кольцом — безопасно вплотную или далеко; а вплотную
// — топор сверху. Стоит у плахи, пока не подойдёшь.
// ---------------------------------------------------------------------------

export const EXEC = { flailR: 2.35, flailW: 0.72, flailWarn: 1.0, chopR: 1.05, chopWarn: 0.8 };

registerBrain('f10_exec', {
  step(sim, m, dt, c, api) {
    if (postWatch(sim, m, dt, c, api, 7, 3)) return;
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    m.data.flCd = (m.data.flCd ?? 0.5) - dt;
    switch (m.mode) {
      case 'alertpost':
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(dy, dx);
        if (m.t > 0.6) api.setMode(m, 'chase');
        return;
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && m.cd <= 0) {
          // Цеп — первым, когда готов: вплотную к палачу от него безопасно.
          if (dist < EXEC.flailR + EXEC.flailW + 0.5 && m.data.flCd <= 0) {
            api.setMode(m, 'flail');
            api.strike(sim, {
              shape: 'ring',
              x: m.x,
              y: m.y,
              r: EXEC.flailR,
              w: EXEC.flailW,
              warn: EXEC.flailWarn,
              dmg: m.dmg * 1.35,
              knock: 7,
              art: 'f10_flail',
              from: m.id,
            });
            return;
          }
          if (dist < 1.35) {
            m.dir = Math.atan2(dy, dx);
            api.setMode(m, 'chop');
            const x = m.x + Math.cos(m.dir) * 1.05;
            const y = m.y + Math.sin(m.dir) * 1.05;
            api.strike(sim, {
              shape: 'circle',
              x,
              y,
              r: EXEC.chopR,
              warn: EXEC.chopWarn,
              dmg: m.dmg * 1.6,
              knock: 6,
              art: 'f10_chop',
              from: m.id,
            });
            return;
          }
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * (dist < 1.4 ? 0.3 : 1), dt);
        return;
      }
      case 'chop':
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        if (m.t > EXEC.chopWarn - 0.24) m.danger = 2.2;
        if (m.t >= EXEC.chopWarn) {
          sim.events.push({ t: 'boom', x: m.x + Math.cos(m.dir), y: m.y + Math.sin(m.dir), r: 0 });
          api.setMode(m, 'recover');
          m.cd = 1.2;
        }
        return;
      case 'flail':
        // Цеп раскручивается над головой: кольцо на полу наливается.
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = Math.atan2(dy, dx);
        if (m.t > EXEC.flailWarn - 0.26) m.danger = EXEC.flailR + EXEC.flailW + 0.4;
        if (m.t >= EXEC.flailWarn) {
          sim.events.push({ t: 'boss', what: 'whip' });
          api.setMode(m, 'recover');
          m.cd = 0.9;
          m.data.flCd = 3.2 + sim.rng();
        }
        return;
      case 'recover':
        recoverStep(m, api, 1.05);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m) {
    if (m.data.post !== undefined) killPost(sim, m.data.post);
  },
});

// ---------------------------------------------------------------------------
// Имп-носильщик: удирает с мешком; бьёшь — сыплет монеты; прижали —
// исчезает в дыму и выскакивает поодаль.
// ---------------------------------------------------------------------------

registerBrain('f10_imp', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    m.data.pCd = (m.data.pCd ?? 0) - dt;
    if (m.mode === 'f10_puff') {
      m.data.ghost = 1;
      m.vx = 0;
      m.vy = 0;
      if (m.t >= 0.35) {
        m.x = m.data.bx;
        m.y = m.data.by;
        m.data.ghost = 0;
        sim.events.push({ t: 'emerge', x: m.x, y: m.y });
        api.setMode(m, 'flee');
      }
      return;
    }
    if (m.mode !== 'flee' && m.mode !== 'chase') api.setMode(m, 'flee');
    // Прижали — дым.
    if (dist < 1.4 && m.data.pCd <= 0) {
      const to = spotAway(sim, api, m.x, m.y, 4, 6.5, h);
      if (to) {
        m.data.bx = to[0];
        m.data.by = to[1];
        m.data.pCd = 3;
        api.zone(sim, { x: m.x, y: m.y, r: 0.6, life: 0.6, art: 'f10_puff' });
        api.zone(sim, { x: to[0], y: to[1], r: 0.6, life: 0.5, art: 'f10_puff' });
        api.setMode(m, 'f10_puff');
        return;
      }
    }
    const away = api.flowDir(sim, m.x, m.y, true);
    const d = away ?? [-dx / (dist || 1), -dy / (dist || 1)];
    // Петляет, хихикая.
    const z = Math.sin(sim.time * 7 + m.id) * 0.5;
    api.steer(sim, m, d[0] - d[1] * z, d[1] + d[0] * z, m.speed, dt);
    m.data.age = (m.data.age ?? 0) + dt;
    if (m.data.age > 20 && dist > 5) {
      api.setMode(m, 'escape');
      m.hp = 0;
    }
  },
  onHit(sim, m, _hit, api) {
    // От каждого удара из мешка сыплется горсть.
    api.dropAt(sim, 'coin', 45, m.x, m.y);
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Король демонов. Ведёт все режимы сам (босс).
//   f10_throne   — сидит на троне: удары отбивает тьма; бросает молнии;
//   f10_command  — встаёт с жезлом в небо: зовёт стражу — В ЭТО ВРЕМЯ уязвим;
//   f10_rise     — встаёт с трона (фаза 1);
//   chase        — идёт на героя, решает: взмах, рубка, гроза;
//   slash/cleave — меч конусом / сверху по линии (меч застревает: stuck);
//   f10_storm    — молнии по клеткам всей арены с безопасными клетками;
//   f10_unfurl   — раскрывает крылья (фаза 2);
//   f10_takeoff, f10_air, f10_dive, f10_landed — взлёт, парение с меткой,
//                  пике, приземление (окно);
//   f10_roar     — рёв бездны (фаза 3): края арены трещат и рушатся.
// ---------------------------------------------------------------------------

export const KING = {
  hp: [0.8, 0.55, 0.28],
  slashR: 3.3,
  slashArc: 2.4,
  slashWarn: 0.85,
  cleaveR: 6.2,
  cleaveW: 0.75,
  cleaveWarn: 0.95,
  stuck: 1.3,
  cmd: 2.8,
  cmdEvery: 8.5,
  hurl: 4.4,
  rise: 1.8,
  unfurl: 1.4,
  roar: 1.6,
  storm: 1.25,
  airT: 2.4,
  lock: 0.75,
  landed: 1.8,
  collapseWarn: 2,
  collapseEvery: 7,
};

interface KingState {
  /** Клетки, сменённые боем: вернуть на `reset`. */
  changed: Map<number, { tile: number; mark: number }>;
  /** Кольца обвала: клетки по удалённости от стены. */
  rings: number[][];
  /** Клетки, что трещат: когда рухнут. */
  falling: Map<number, number>;
  ringNext: number;
  wave: number;
  stormN: number;
  /** Кто пришёл по зову трона. */
  summoned: Set<number>;
}

const KSTATE = new WeakMap<Sim, KingState>();

function kingState(sim: Sim): KingState {
  let st = KSTATE.get(sim);
  if (!st) {
    st = {
      changed: new Map(),
      rings: [],
      falling: new Map(),
      ringNext: 0,
      wave: 0,
      stormN: 0,
      summoned: new Set(),
    };
    KSTATE.set(sim, st);
  }
  return st;
}

/** Сменить клетку, запомнив, какой она была (для сброса боя). */
function retile(sim: Sim, api: SimApi, i: number, tile: number, mark: number): void {
  const st = kingState(sim);
  const w = sim.world;
  if (!st.changed.has(i)) st.changed.set(i, { tile: sim.tiles[i], mark: w.mark[i] });
  api.setTile(sim, i % w.w, Math.floor(i / w.w), tile, mark);
}

const kingOf = (sim: Sim) => sim.mobs.find((x) => x.kind === 'f10boss' && x.mode !== 'dying');

const hasteOf = (sim: Sim) => {
  const p = sim.boss?.phase ?? 0;
  return p >= 3 ? 1.3 : p >= 2 ? 1.15 : 1;
};

// v2.86 — только рисунок: зона-картинка (`api.vfx`: без урона и статусов, номер
// мимо `nextId`) — пыль, посадка, рёв, двери, обвал рисует `f10-boss-fx.ts`.
// Своих `f10_fx*` разом не больше 36, пыли движения — не больше 24.
type VfxIn = {
  ang?: number;
  vd?: number;
  n?: number;
  cells?: number[];
  ww?: number;
  above?: boolean;
};
function vfx(
  sim: Sim,
  api: SimApi,
  art: string,
  x: number,
  y: number,
  life: number,
  o: VfxIn = {},
  move = false,
): void {
  let n = 0;
  for (const z of sim.zones) if (z.art?.startsWith('f10_fx')) n++;
  if (n < (move ? 24 : 36)) api.vfx(sim, { x, y, r: 0.5, life, art, ...o } as ZoneIn & VfxIn);
}
// v2.86 — только рисунок: тряска по силе удара, вдали от героя — вполсилы.
const vShake = (sim: Sim, x: number, y: number, k: number) =>
  sim.events.push({ t: 'shake', k: hypot(sim.hero.x - x, sim.hero.y - y) < 7 ? k : k * 0.5 });

/** Трон как предмет: пока король сидит — насквозь, встал — стоит. */
const throneProp = (sim: Sim): Prop | undefined =>
  sim.props.find((p) => p.kind === 'deco' && p.obj.ref === 'f10_throne');

/** Стража из боковых дверей арены. */
function summonWave(sim: Sim, api: SimApi, b: BossFight): void {
  const st = kingState(sim);
  const live = sim.mobs.filter((x) => st.summoned.has(x.id) && x.mode !== 'dying').length;
  const holes = sim.burrows.filter(
    (x) => x.obj.out && api.inArena(sim, x.obj.out[0] + 0.5, x.obj.out[1] + 0.5),
  );
  if (!holes.length) return;
  st.wave += 1;
  const kinds =
    st.wave % 2 === 1 ? ['f10_guard', 'f10_guard'] : ['f10_hound', 'f10_hound', 'f10_guard'];
  const room = Math.max(0, 6 - live);
  for (let i = 0; i < Math.min(room, kinds.length); i++) {
    const hb = holes[(st.wave + i) % holes.length];
    hb.cd = 0;
    const mm = api.fromBurrow(sim, hb, kinds[i]);
    mm.t = -i * 0.3;
    mm.rush = true;
    st.summoned.add(mm.id);
    // v2.86 — только рисунок: дверь распахивается — свет и пыль, по очереди со стражей.
    const out = hb.obj.out ?? [hb.obj.x, hb.obj.y + 1];
    vfx(sim, api, 'f10_fxgate', hb.obj.x + 0.5, hb.obj.y + 0.5, 1.6 + i * 0.3, {
      ang: Math.atan2(out[1] - hb.obj.y, out[0] - hb.obj.x),
      vd: i * 0.3,
    });
  }
  void b;
}

/** Гроза по арене: полосы или клетки, между ними — безопасно. */
function kingStorm(sim: Sim, api: SimApi, b: BossFight, lead: Mob): void {
  const st = kingState(sim);
  const w = sim.world;
  let x0 = 1e9;
  let x1 = -1e9;
  let y0 = 1e9;
  let y1 = -1e9;
  for (const i of b.cells) {
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const kind = st.stormN % 3;
  st.stormN += 1;
  const dmg = lead.dmg * 1.1;
  const warn = 1.15 / hasteOf(sim);
  if (kind === 0 || kind === 1) {
    // Полосы в две клетки через две: вдоль или поперёк зала.
    const across = kind === 0;
    const off = Math.floor(sim.rng() * 2) * 2;
    const from = across ? y0 : x0;
    const to = across ? y1 : x1;
    for (let v = from + off; v <= to; v += 4) {
      api.strike(sim, {
        shape: 'line',
        x: across ? x0 : v + 1,
        y: across ? v + 1 : y0,
        r: across ? x1 - x0 + 1 : y1 - y0 + 1,
        w: 1,
        ang: across ? 0 : Math.PI / 2,
        warn,
        dmg,
        knock: 3,
        art: 'f10_bolt_line',
        from: lead.id,
      });
    }
  } else {
    // Клетки 3×3 в шахматку.
    const par = Math.floor(sim.rng() * 2);
    for (let y = y0; y <= y1; y += 3)
      for (let x = x0; x <= x1; x += 3) {
        if ((Math.floor((x - x0) / 3) + Math.floor((y - y0) / 3) + par) % 2) continue;
        api.strike(sim, {
          shape: 'circle',
          x: x + 1.5,
          y: y + 1.5,
          r: 1.45,
          warn,
          dmg,
          knock: 3,
          art: 'f10_bolt',
          from: lead.id,
        });
      }
  }
  sim.events.push({ t: 'boss', what: 'f10_storm_wall' });
}

/** Кольца обвала: клетки арены по удалённости от стены (0 — у стены). */
function buildRings(sim: Sim, b: BossFight): number[][] {
  const w = sim.world;
  const rings: number[][] = [[], [], []];
  const W = w.w;
  const gateCols = b.gates.map((g) => g % W);
  const gx0 = Math.min(...gateCols) - 1;
  const gx1 = Math.max(...gateCols) + 1;
  for (const i of b.cells) {
    const x = i % W;
    const y = Math.floor(i / W);
    const mk = w.mark[i];
    // Ковёр, помост и дорога к воротам не рушатся — к выходу путь есть всегда.
    if (mk === F10_MARK.carpet || mk === F10_MARK.dais) continue;
    if (x >= gx0 && x <= gx1) continue;
    // Под колонной и жаровней — не рушим: предмет повис бы над пропастью.
    if (sim.props.some((p) => p.alive && Math.floor(p.x) === x && Math.floor(p.y) === y && p.r > 0))
      continue;
    let d = 9;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const j = (y + dy) * W + x + dx;
        if (!b.cells.has(j)) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)) - 1);
      }
    if (d >= 0 && d < 3) rings[d].push(i);
  }
  return rings;
}

/** Ближняя клетка пола, которая не рушится, — туда сносит сорвавшегося. */
function safeCell(sim: Sim, from: number, bad: (i: number) => boolean): number | null {
  const W = sim.world.w;
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const i = q.shift()!;
    if (!bad(i) && sim.tiles[i] !== T_DEEP && sim.tiles[i] !== T_WALL && i !== from) return i;
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      if (seen.has(j) || j < 0 || j >= sim.tiles.length) continue;
      if (sim.tiles[j] === T_WALL) continue;
      seen.add(j);
      if (seen.size > 400) return null;
      q.push(j);
    }
  }
  return null;
}

function kingStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const h = sim.hero;
  const { dx, dy, dist } = c;
  const b = sim.boss;
  const phase = b?.phase ?? 0;
  const haste = hasteOf(sim);
  m.tele = null;
  m.danger = 0;
  m.data.phase = phase;
  m.data.stormCd = (m.data.stormCd ?? 6) - dt;
  m.data.flyCd = (m.data.flyCd ?? 5) - dt;
  if (heroDown(sim)) {
    m.vx *= 0.85;
    m.vy *= 0.85;
    return;
  }
  switch (m.mode) {
    // --- Фаза 0: трон.
    case 'f10_throne': {
      m.x = m.data.kx;
      m.y = m.data.ky;
      m.vx = 0;
      m.vy = 0;
      m.face = Math.PI / 2;
      m.data.cmdCd = (m.data.cmdCd ?? 2.5) - dt;
      m.data.hurlCd = (m.data.hurlCd ?? 2) - dt;
      if (m.data.cmdCd <= 0) {
        api.setMode(m, 'f10_command');
        api.zone(sim, { x: m.x, y: m.y + 0.3, r: 2.2, life: KING.cmd, art: 'f10_command' });
        return;
      }
      if (m.data.hurlCd <= 0) {
        // Молния с трона: метка под героем, у второй волны — две.
        m.data.hurlCd = KING.hurl;
        const n = (kingState(sim).wave ?? 0) >= 2 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const a = sim.rng() * TAU;
          const x = h.x + (i ? Math.cos(a) * 1.8 : 0);
          const y = h.y + (i ? Math.sin(a) * 1.8 : 0);
          if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
          api.strike(sim, {
            shape: 'circle',
            x,
            y,
            r: 1.05,
            warn: 1.1,
            dmg: m.dmg * 1.0,
            knock: 4,
            art: 'f10_bolt',
            from: m.id,
          });
        }
      }
      return;
    }
    case 'f10_command': {
      m.x = m.data.kx;
      m.y = m.data.ky;
      m.vx = 0;
      m.vy = 0;
      m.face = Math.PI / 2;
      if (!m.data.called && m.t >= 0.8) {
        m.data.called = 1;
        if (b) summonWave(sim, api, b);
        const first = !m.data.said;
        m.data.said = 1;
        sim.events.push(
          first
            ? { t: 'boss', what: 'roar', text: 'СТРАЖА!', sub: 'пока король зовёт — он открыт' }
            : { t: 'boss', what: 'roar' },
        );
      }
      if (m.t >= KING.cmd) {
        m.data.called = 0;
        m.data.cmdCd = KING.cmdEvery;
        api.setMode(m, 'f10_throne');
      }
      return;
    }
    case 'f10_rise': {
      // Встаёт с трона: тьма спадает, ударная волна вокруг.
      m.data.ghost = m.t < KING.rise - 0.2 ? 1 : 0;
      m.vx = 0;
      m.vy = 0;
      m.face = Math.PI / 2;
      if (!m.data.waved && m.t >= 0.4) {
        m.data.waved = 1;
        api.strike(sim, {
          shape: 'circle',
          x: m.x,
          y: m.y,
          r: 3.2,
          warn: 1,
          dmg: m.dmg * 0.8,
          knock: 10,
          art: 'f10_shock',
          from: m.id,
        });
      }
      if (m.t >= KING.rise) {
        m.data.ghost = 0;
        m.data.waved = 0;
        const tp = throneProp(sim);
        if (tp) tp.r = 0.55;
        // Король сошёл с помоста — шаг вперёд, трон за спиной.
        m.y += 0.6;
        api.setMode(m, 'chase');
        m.data.stormCd = 4;
      }
      return;
    }
    case 'chase': {
      m.data.ghost = 0;
      m.data.z = 0;
      const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
      api.steer(sim, m, cx, cy, m.speed * haste * (dist < 2.4 ? 0.35 : 1), dt);
      // v2.86 — только рисунок: тяжёлый шаг — пыль из-под сапога, сапоги по очереди.
      m.data.vfxWalk = (m.data.vfxWalk ?? 0) + hypot(m.vx, m.vy) * dt;
      if (m.data.vfxWalk > 0.8) {
        m.data.vfxWalk = 0;
        m.data.vfxFoot = 1 - (m.data.vfxFoot ?? 0);
        vfx(
          sim,
          api,
          'f10_fxstep',
          m.x,
          m.y,
          0.8,
          { ang: Math.atan2(m.vy, m.vx), n: m.data.vfxFoot },
          true,
        );
      }
      if (m.t < 0.7 / haste) return;
      const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
      if (phase >= 2 && m.data.flyCd <= 0) {
        api.setMode(m, 'f10_takeoff');
        return;
      }
      if (m.data.stormCd <= 0 && phase >= 1) {
        api.setMode(m, 'f10_storm');
        return;
      }
      if (dist < KING.slashR - 0.3) {
        m.dir = Math.atan2(dy, dx);
        api.setMode(m, 'slash');
        return;
      }
      if (see && dist < KING.cleaveR - 0.4 && m.t > 1.2 / haste) {
        m.dir = Math.atan2(dy, dx);
        api.setMode(m, 'cleave');
        return;
      }
      return;
    }
    case 'slash': {
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t < 0.25) m.dir = Math.atan2(dy, dx);
      m.face = m.dir;
      if (!m.data.lit && m.t >= 0.25) {
        m.data.lit = 1;
        api.strike(sim, {
          shape: 'cone',
          x: m.x,
          y: m.y,
          r: KING.slashR,
          ang: m.dir,
          arc: KING.slashArc,
          warn: KING.slashWarn / haste - 0.25,
          dmg: m.dmg * 1.9,
          knock: 9,
          art: 'f10_slash',
          from: m.id,
        });
      }
      if (m.t >= KING.slashWarn / haste) {
        m.data.lit = 0;
        sim.events.push({ t: 'boss', what: 'whip' });
        api.setMode(m, 'recover');
      }
      return;
    }
    case 'cleave': {
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t < 0.3) m.dir = Math.atan2(dy, dx);
      m.face = m.dir;
      const len = Math.min(KING.cleaveR, clearDist(sim, api, m.x, m.y, m.dir, KING.cleaveR));
      if (!m.data.lit && m.t >= 0.3) {
        m.data.lit = 1;
        m.data.len = len;
        api.strike(sim, {
          shape: 'line',
          x: m.x,
          y: m.y,
          r: len,
          w: KING.cleaveW,
          ang: m.dir,
          warn: KING.cleaveWarn / haste - 0.3,
          dmg: m.dmg * 2.1,
          knock: 8,
          art: 'f10_cleave',
          from: m.id,
        });
      }
      if (m.t >= KING.cleaveWarn / haste) {
        m.data.lit = 0;
        sim.hitstop = Math.max(sim.hitstop, 0.06);
        sim.events.push({
          t: 'boom',
          x: m.x + Math.cos(m.dir) * 2,
          y: m.y + Math.sin(m.dir) * 2,
          r: 0,
        });
        // Трещина по полу вдоль удара — картинка, без урона.
        const z: ZoneIn & { ang: number; len: number } = {
          x: m.x,
          y: m.y,
          r: 0.5,
          life: 2.2,
          art: 'f10_rift',
          ang: m.dir,
          len: m.data.len ?? len,
        };
        api.zone(sim, z);
        api.setMode(m, 'stuck');
      }
      return;
    }
    case 'stuck':
      // Меч увяз в плитах: главное окно этой фазы.
      m.vx *= 0.7;
      m.vy *= 0.7;
      m.face = m.dir;
      if (m.t >= KING.stuck / Math.sqrt(haste)) api.setMode(m, 'recover');
      return;
    case 'f10_storm': {
      m.vx *= 0.7;
      m.vy *= 0.7;
      m.face = Math.PI / 2;
      if (!m.data.lit && m.t >= 0.35 && b) {
        m.data.lit = 1;
        kingStorm(sim, api, b, m);
        F10_FX.storm = performance.now() / 1000 + 1.4;
      }
      if (m.t >= KING.storm) {
        m.data.lit = 0;
        m.data.stormCd = (phase >= 3 ? 9 : 11) / haste;
        api.setMode(m, 'chase');
      }
      return;
    }
    case 'f10_unfurl':
      // Крылья раскрываются: рывок ветра, стёкла летят.
      m.data.ghost = m.t < KING.unfurl - 0.2 ? 1 : 0;
      m.vx *= 0.7;
      m.vy *= 0.7;
      m.face = Math.PI / 2;
      // v2.86 — только рисунок: ветер закручивается к королю, в 0,9 с крылья распахиваются — порыв.
      if (m.t <= dt) vfx(sim, api, 'f10_fxgust', m.x, m.y, KING.unfurl + 0.9);
      if (m.t >= 0.9 && m.t - dt < 0.9) vShake(sim, m.x, m.y, 0.3);
      if (m.t >= KING.unfurl) {
        m.data.ghost = 0;
        m.data.flyCd = 2.5;
        api.setMode(m, 'chase');
      }
      return;
    case 'f10_takeoff':
      m.vx *= 0.6;
      m.vy *= 0.6;
      // v2.86 — только рисунок: крылья бьют в пол — пыль кольцом.
      if (m.t <= dt) vfx(sim, api, 'f10_fxwing', m.x, m.y, 1.1);
      m.data.z = Math.min(1, m.t / 0.6) * 3;
      m.data.ghost = m.t > 0.3 ? 1 : 0;
      if (m.t >= 0.6) {
        m.data.ghost = 1;
        api.setMode(m, 'f10_air');
        const z: ZoneIn & { follow: number; mob: number } = {
          x: h.x,
          y: h.y,
          r: 1.7,
          life: KING.airT,
          art: 'f10_divemark',
          follow: 1,
          mob: m.id,
        };
        api.zone(sim, z);
        sim.events.push({
          t: 'boss',
          what: 'f10_swoop_trap',
          text: 'С НЕБА',
          sub: 'метка ходит за тобой — уйди, когда замрёт',
        });
      }
      return;
    case 'f10_air': {
      // Кружит над ареной, пока метка идёт за героем; перья пламени.
      m.data.ghost = 1;
      m.data.z = 3 + Math.sin(m.t * 5) * 0.3;
      // v2.86 — только рисунок: взмах крыльев поднимает пыль под королём.
      if (sim.time >= (m.data.vfxFlap ?? 0)) {
        m.data.vfxFlap = sim.time + 0.4;
        vfx(sim, api, 'f10_fxflap', m.x, m.y, 0.7, {}, true);
      }
      const mark = sim.zones.find(
        (z) => z.art === 'f10_divemark' && (z as ZoneIn & { mob?: number }).mob === m.id,
      );
      if (mark) {
        const ex = mark.x - m.x;
        const ey = mark.y - m.y;
        const ed = hypot(ex, ey);
        if (ed > 0.3) {
          m.vx = (ex / ed) * Math.min(7, ed * 3);
          m.vy = (ey / ed) * Math.min(7, ed * 3);
        }
      }
      m.data.feather = (m.data.feather ?? 0.5) - dt;
      if (m.data.feather <= 0) {
        m.data.feather = 0.55;
        const a = sim.rng() * TAU;
        const r = 1.5 + sim.rng() * 2.5;
        const x = h.x + Math.cos(a) * r;
        const y = h.y + Math.sin(a) * r;
        if (!api.solidTile(sim, Math.floor(x), Math.floor(y)))
          api.strike(sim, {
            shape: 'circle',
            x,
            y,
            r: 0.6,
            warn: 0.9,
            dmg: m.dmg * 0.7,
            knock: 2,
            art: 'f10_feather',
            from: m.id,
            above: true,
          }); // v2.86 — только рисунок: `above`
      }
      if (m.t >= KING.airT - KING.lock && !m.data.locked && mark) {
        // Метка замерла: через 0,75 с сюда упадёт король.
        m.data.locked = 1;
        (mark as ZoneIn & { follow?: number }).follow = 0;
        m.data.dx = mark.x;
        m.data.dy = mark.y;
        api.strike(sim, {
          shape: 'circle',
          x: mark.x,
          y: mark.y,
          r: 1.8,
          warn: KING.lock,
          dmg: m.dmg * 1.8,
          knock: 11,
          art: 'f10_diveland',
          from: m.id,
        });
      }
      if (m.t >= KING.airT) {
        m.data.locked = 0;
        api.setMode(m, 'f10_dive');
        m.data.sx = m.x;
        m.data.sy = m.y;
      }
      return;
    }
    case 'f10_dive': {
      // Пике: 0,18 с — и он на земле.
      const k = Math.min(1, m.t / 0.18);
      m.x = m.data.sx + (m.data.dx - m.data.sx) * k;
      m.y = m.data.sy + (m.data.dy - m.data.sy) * k;
      m.vx = 0;
      m.vy = 0;
      m.data.z = 3 * (1 - k);
      m.data.ghost = 1;
      if (k >= 1) {
        m.data.z = 0;
        m.data.ghost = 0;
        sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
        sim.events.push({ t: 'boss', what: 'f10_land_wall' });
        // v2.86 — только рисунок: посадка — воронка, трещины, обломки; тряска и вспышка.
        vfx(sim, api, 'f10_fxtouch', m.x, m.y, 1.8);
        vShake(sim, m.x, m.y, 0.3);
        sim.events.push({ t: 'flash', k: 0.2, color: '#ff6a3a' });
        // Ударная волна от приземления — кольцом.
        api.strike(sim, {
          shape: 'ring',
          x: m.x,
          y: m.y,
          r: 3.1,
          w: 0.55,
          warn: 0.35,
          dmg: m.dmg * 0.9,
          knock: 7,
          art: 'f10_shockring',
          from: m.id,
        });
        m.data.flyCd = (phase >= 3 ? 8 : 10) / haste;
        api.setMode(m, 'f10_landed');
      }
      return;
    }
    case 'f10_landed':
      // Сел тяжело, крылья по полу: окно.
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t >= KING.landed / Math.sqrt(haste)) api.setMode(m, 'chase');
      return;
    case 'f10_roar':
      m.data.ghost = m.t < KING.roar - 0.2 ? 1 : 0;
      // v2.86 — только рисунок: кольца рёва от головы, пол дрожит.
      if (m.t <= dt) {
        vfx(sim, api, 'f10_fxroar', m.x, m.y, KING.roar + 0.4, { above: true });
        vfx(sim, api, 'f10_fxquake', m.x, m.y, KING.roar + 0.6);
      }
      m.vx *= 0.7;
      m.vy *= 0.7;
      m.face = Math.PI / 2;
      if (m.t >= KING.roar) {
        m.data.ghost = 0;
        api.setMode(m, 'chase');
      }
      return;
    case 'recover':
      recoverStep(m, api, 0.75 / haste);
      return;
    default:
      api.setMode(m, 'chase');
  }
}

registerBrain('f10boss', {
  raw: true,
  step: kingStep,
  onHit(_sim, m) {
    // Сидя на троне — тьма отбивает удары; зовёт стражу — открыт.
    if (m.mode === 'f10_throne') return 0;
    if (m.mode === 'f10_command') return 1.6;
    if (m.mode === 'stuck' || m.mode === 'f10_landed') return 1.3;
    return 1;
  },
});

registerBoss('f10boss', {
  start(sim, b, lead, api) {
    API_REF.api = api;
    b.phase = 0;
    // Прошлый бой (победа) оставил зал обрушенным — перед новым он цел.
    restoreArena(sim, api);
    const tp = throneProp(sim);
    if (tp) tp.r = 0;
    sim.zones = sim.zones.filter((z) => z.art !== 'f10_redglow');
    const st = kingState(sim);
    st.rings = buildRings(sim, b);
    lead.data.kx = lead.x;
    lead.data.ky = lead.y;
    lead.data.cmdCd = 3;
    lead.data.hurlCd = 2.2;
    lead.face = Math.PI / 2;
    api.setMode(lead, 'f10_throne');
    sim.events.push({
      t: 'boss',
      what: 'f10_wake_call',
      text: 'КОРОЛЬ ДЕМОНОВ',
      sub: 'на троне — не достать; бей, когда зовёт стражу',
    });
  },
  step(sim, b, dt, api) {
    API_REF.api = api;
    const lead = kingOf(sim);
    if (!lead) return;
    const st = kingState(sim);
    const k = lead.hp / lead.maxHp;
    const W = sim.world.w;
    // Смена фаз по засечкам.
    if (
      b.phase === 0 &&
      k <= KING.hp[0] &&
      (lead.mode === 'f10_throne' || lead.mode === 'f10_command')
    ) {
      b.phase = 1;
      api.setMode(lead, 'f10_rise');
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'КОРОЛЬ ВСТАЁТ',
        sub: 'меч и молнии — смотри под ноги',
      });
      // Арена: жаровни вспыхивают красным, по плитам — отсвет.
      api.zone(sim, { x: b.obj.x + 0.5, y: b.obj.y + 0.5, r: 13, life: 1e9, art: 'f10_redglow' });
    }
    if (b.phase === 1 && k <= KING.hp[1]) {
      b.phase = 2;
      api.setMode(lead, 'f10_unfurl');
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'КРЫЛЬЯ',
        sub: 'взлетает — следи за меткой пике',
      });
      // Витражи арены вылетают: стекло сыплется у северной стены.
      for (const i of b.cells) {
        const up = i - W;
        if (sim.world.mark[up] === F10_MARK.window) retile(sim, api, up, T_WALL, F10_MARK.broken);
      }
      for (const i of b.cells) {
        const up = i - W;
        if (st.changed.has(up) && sim.rng() < 0.7)
          api.strike(sim, {
            shape: 'circle',
            x: (i % W) + 0.5,
            y: Math.floor(i / W) + 0.5 + sim.rng() * 1.5,
            r: 0.75,
            warn: 0.7 + sim.rng() * 0.5,
            dmg: lead.dmg * 0.8,
            knock: 2,
            art: 'f10_glass',
            from: lead.id,
          });
      }
    }
    if (
      b.phase === 2 &&
      k <= KING.hp[2] &&
      lead.mode !== 'f10_air' &&
      lead.mode !== 'f10_dive' &&
      lead.mode !== 'f10_takeoff'
    ) {
      b.phase = 3;
      api.setMode(lead, 'f10_roar');
      st.ringNext = sim.time + 1;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'БЕЗДНА',
        sub: 'края зала рушатся — держись ковра',
      });
    }
    // Обвал краёв: кольцо трещит, потом рушится.
    if (b.phase >= 3 && st.ringNext > 0 && sim.time >= st.ringNext) {
      const r = st.rings.shift();
      if (r && r.length) {
        for (const i of r) {
          if (sim.tiles[i] === T_DEEP) continue;
          retile(sim, api, i, T_FLOOR, F10_MARK.cracking);
          st.falling.set(i, sim.time + KING.collapseWarn);
        }
        sim.events.push({
          t: 'boss',
          what: 'f10_crumble_trap',
          text: 'ПОЛ ТРЕЩИТ',
          sub: 'отойди от края',
        });
        // v2.86 — только рисунок: трещины наливаются жаром снизу, пол вздрагивает.
        vfx(sim, api, 'f10_fxcrack', lead.x, lead.y, KING.collapseWarn + 0.1, {
          cells: r.filter((i) => st.falling.has(i)),
          ww: W,
        });
        vShake(sim, lead.x, lead.y, 0.15);
        st.ringNext = sim.time + KING.collapseEvery;
      } else st.ringNext = 0;
    }
    if (st.falling.size) {
      const h = sim.hero;
      const hi = Math.floor(h.y) * W + Math.floor(h.x);
      let fell = 0;
      const vFell: number[] = []; // v2.86 — только рисунок
      for (const [i, at] of st.falling) {
        if (sim.time < at) continue;
        st.falling.delete(i);
        retile(sim, api, i, T_DEEP, F10_MARK.fallen);
        fell += 1;
        vFell.push(i); // v2.86 — только рисунок
        // Стоял на краю — сорвался: удар и на ближнюю твёрдую клетку.
        const cx = (i % W) + 0.5;
        const cy = Math.floor(i / W) + 0.5;
        if (
          i === hi ||
          (Math.abs(h.x - cx) < 0.5 + h.r * 0.6 && Math.abs(h.y - cy) < 0.5 + h.r * 0.6)
        ) {
          const to = safeCell(sim, hi, (j) => st.falling.has(j) || sim.tiles[j] === T_DEEP);
          if (to !== null && !heroDown(sim)) {
            api.moveHero(sim, (to % W) + 0.5, Math.floor(to / W) + 0.5);
            h.inv = 0;
            api.hurtHero(sim, rawShare(sim, 0.12), cx, cy, 0);
            sim.events.push({
              t: 'boss',
              what: 'f10_edge_trap',
              text: 'СОРВАЛСЯ',
              sub: 'край ушёл из-под ног',
            });
          }
        }
        // Мобы на краю — вниз.
        for (const mm of sim.mobs)
          if (
            !mm.kind.endsWith('boss') &&
            mm.mode !== 'dying' &&
            Math.floor(mm.x) === i % W &&
            Math.floor(mm.y) === Math.floor(i / W)
          ) {
            mm.hp = 0;
            api.setMode(mm, 'escape');
          }
      }
      if (fell) sim.events.push({ t: 'boom', x: lead.x, y: lead.y, r: 0 });
      // v2.86 — только рисунок: плиты уходят в бездну, оттуда — огонь и угольки.
      if (vFell.length) {
        vfx(sim, api, 'f10_fxfall', lead.x, lead.y, 1.3, { cells: vFell, ww: W });
        vfx(sim, api, 'f10_fxember', lead.x, lead.y, 1.7, { cells: vFell, ww: W, above: true });
        vShake(sim, lead.x, lead.y, 0.25);
      }
    }
    // Зов стражи — только пока сидит на троне.
    void dt;
  },
  notches: () => KING.hp,
  reset(sim) {
    // Арена та же, что до боя: плиты, витражи, трон.
    if (API_REF.api) restoreArena(sim, API_REF.api);
    else KSTATE.delete(sim);
    const tp = throneProp(sim);
    if (tp) tp.r = 0;
  },
});

/** Вернуть плиты, витражи и край, сменённые боем. */
function restoreArena(sim: Sim, api: SimApi): void {
  const st = KSTATE.get(sim);
  if (st) {
    const W = sim.world.w;
    for (const [i, v] of st.changed) api.setTile(sim, i % W, Math.floor(i / W), v.tile, v.mark);
  }
  KSTATE.delete(sim);
}

/** Сценарий босса получает `api` только в `step`; для `start`/`reset` — последний. */
const API_REF: { api: SimApi | null } = { api: null };

// ---------------------------------------------------------------------------
// Правила этажа: посты, шипы Врат, мост, гроза, сокровищница, печать мага.
// ---------------------------------------------------------------------------

interface Post {
  id: number;
  kind: string;
  mode: string;
  x: number;
  y: number;
  /** Живой моб поста (id) или 0. */
  mob: number;
  dead: boolean;
  /** Для псов на цепи — столб. */
  chain?: { px: number; py: number };
  /** Куда смотрит рыцарь на посту. */
  look?: number;
  area: string;
  /** Горгулья Сокровищницы. */
  vault?: boolean;
}

interface SpikeRow {
  cells: number[];
  y: number;
  /** Сдвиг фазы волны, с. */
  off: number;
  x0: number;
  x1: number;
}

interface F10State {
  posts: Post[];
  spikes: SpikeRow[];
  spikeT: number;
  /** Мост: ветхий пролёт и стоянка рыцарей. */
  fragile: number[];
  fragTop: number;
  bridgeX0: number;
  bridgeX1: number;
  bridgeState: 'idle' | 'crack' | 'fallen' | 'done';
  bridgeT: number;
  bridgeOn: number;
  bridgeKnights: number[];
  knightSpot: [number, number][];
  /** Гроза Витражного зала. */
  storm: number[];
  stormBox: [number, number, number, number];
  stormState: 'idle' | 'on' | 'rest';
  stormT: number;
  stormWave: number;
  stormNext: number;
  /** Когда герой вышел из зала посреди грозы (0 — внутри). */
  stormOut: number;
  /** Добыча грозы уже выдана в этой вылазке. */
  stormPaid: boolean;
  stormWindows: number[];
  /** Сокровищница. */
  vaultChest: Prop | null;
  vaultDoor: number[];
  vaultState: 'idle' | 'shut' | 'done';
  vaultT: number;
  /** Сменённые клетки мира (вернуть при сбросе событий). */
  saved: Map<number, { tile: number; mark: number }>;
}

const STATE = new WeakMap<Sim, F10State>();
let postSeq = 1;

/** Горгульи Сокровищницы и прочие посты: убитый не встаёт до конца вылазки. */
function killPost(sim: Sim, id: number): void {
  const st = STATE.get(sim);
  const p = st?.posts.find((x) => x.id === id);
  if (p) {
    p.dead = true;
    p.mob = 0;
  }
}

function scan(sim: Sim, api: SimApi): F10State {
  const w = sim.world;
  const W = w.w;
  const posts: Post[] = [];
  const spikeCells: number[] = [];
  const fragile: number[] = [];
  const storm: number[] = [];
  const vault: number[] = [];
  const stormWindows: number[] = [];
  const bridge: number[] = [];
  const add = (kind: string, mode: string, x: number, y: number, extra: Partial<Post> = {}) =>
    posts.push({
      id: postSeq++,
      kind,
      mode,
      x: x + 0.5,
      y: y + 0.5,
      mob: 0,
      dead: false,
      area: w.rowArea[y],
      ...extra,
    });
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = w.mark[i];
      if (k === F10_MARK.post) add('f10_guard', 'f10_stand', x, y);
      else if (k === F10_MARK.expost) add('f10_exec', 'f10_stand', x, y);
      else if (k === F10_MARK.plinth) add('f10_gargoyle', 'f10_stone', x, y);
      else if (k === F10_MARK.kpost) {
        // Рыцарь смотрит туда, где длиннее всего пол — вдоль моста.
        let look = 0;
        let best = -1;
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const d = clearDist(sim, api, x + 0.5, y + 0.5, a, 14);
          if (d > best) {
            best = d;
            look = a;
          }
        }
        add('f10_knight', 'f10_patrol', x, y, { look });
      } else if (k === F10_MARK.spike) spikeCells.push(i);
      else if (k === F10_MARK.storm) storm.push(i);
      else if (k === F10_MARK.vault) vault.push(i);
      else if (k === F10_MARK.bridge && w.rowArea[y] === F10_GATES) bridge.push(i);
    }
  // Псы на цепях — у столбов псарни.
  for (const o of w.objs)
    if (o.kind === 'deco' && o.ref === 'f10_post') {
      for (const [ox, oy] of [
        [1.2, 0.4],
        [-1.1, -0.3],
      ] as [number, number][])
        add('f10_hound', 'chase', o.x + ox, o.y + oy, {
          chain: { px: o.x + 0.5, py: o.y + 0.5 },
        });
    }
  // Шипы: ряды по y — волна идёт с юга на север.
  const rows = new Map<number, number[]>();
  for (const i of spikeCells) {
    const y = Math.floor(i / W);
    rows.set(y, [...(rows.get(y) ?? []), i]);
  }
  const ys = [...rows.keys()].sort((a, b) => b - a);
  const spikes: SpikeRow[] = ys.map((y, n) => {
    const cells = rows.get(y)!;
    const xs = cells.map((i) => i % W);
    return { cells, y, off: n * 0.45, x0: Math.min(...xs), x1: Math.max(...xs) };
  });
  // Мост Врат: ветхий пролёт — южная часть прямого сегмента (x ≤ 33).
  const south = bridge.filter((i) => i % W <= 33);
  const ysB = south.map((i) => Math.floor(i / W));
  const yMax = ysB.length ? Math.max(...ysB) : 0;
  const yMin = ysB.length ? Math.min(...ysB) : 0;
  // Ветхие доски — 8 рядов в середине южного пролёта.
  const fragTop = yMax - 9;
  for (const i of south) {
    const y = Math.floor(i / W);
    if (y >= fragTop && y <= fragTop + 7) fragile.push(i);
  }
  const xsB = south.map((i) => i % W);
  // Стоянка рыцарей — северный конец моста (у Предмостья).
  const north = bridge.filter((i) => i % W >= 40);
  const nY = north.length ? Math.min(...north.map((i) => Math.floor(i / W))) : yMin;
  const knightSpot: [number, number][] = north
    .filter((i) => Math.floor(i / W) <= nY + 1 && i % W !== 42)
    .slice(0, 2)
    .map((i) => [(i % W) + 0.5, Math.floor(i / W) + 0.5]);
  // Витражный зал: рамка и окна над ним.
  let sx0 = 1e9;
  let sx1 = -1e9;
  let sy0 = 1e9;
  let sy1 = -1e9;
  for (const i of storm) {
    sx0 = Math.min(sx0, i % W);
    sx1 = Math.max(sx1, i % W);
    sy0 = Math.min(sy0, Math.floor(i / W));
    sy1 = Math.max(sy1, Math.floor(i / W));
  }
  if (storm.length)
    for (let x = sx0; x <= sx1; x++) {
      const i = (sy0 - 1) * W + x;
      if (w.mark[i] === F10_MARK.window) stormWindows.push(i);
    }
  // Сокровищница: рамка зала, сундук в ней и дверь — пол рядом, но снаружи.
  let vx0 = 1e9;
  let vx1 = -1e9;
  let vy0 = 1e9;
  let vy1 = -1e9;
  for (const i of vault) {
    vx0 = Math.min(vx0, i % W);
    vx1 = Math.max(vx1, i % W);
    vy0 = Math.min(vy0, Math.floor(i / W));
    vy1 = Math.max(vy1, Math.floor(i / W));
  }
  const inVault = (x: number, y: number) => x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;
  const door: number[] = [];
  for (const i of vault)
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      const x = j % W;
      const y = Math.floor(j / W);
      if (inVault(x, y) || sim.tiles[j] === T_WALL || door.includes(j)) continue;
      door.push(j);
    }
  let chest: Prop | null = null;
  for (const p of sim.props)
    if (p.kind === 'secret' && inVault(Math.floor(p.x), Math.floor(p.y))) chest = p;
  for (const p of posts)
    if (p.kind === 'f10_gargoyle' && inVault(Math.floor(p.x), Math.floor(p.y))) p.vault = true;
  return {
    posts,
    spikes,
    spikeT: 0,
    fragile,
    fragTop,
    bridgeX0: xsB.length ? Math.min(...xsB) : 0,
    bridgeX1: xsB.length ? Math.max(...xsB) : 0,
    bridgeState: 'idle',
    bridgeT: 0,
    bridgeOn: -99,
    bridgeKnights: [],
    knightSpot,
    storm,
    stormBox: [sx0, sy0, sx1, sy1],
    stormState: 'idle',
    stormT: 0,
    stormWave: 0,
    stormNext: 0,
    stormOut: 0,
    stormPaid: false,
    stormWindows,
    vaultChest: chest,
    vaultDoor: door,
    vaultState: 'idle',
    vaultT: 0,
    saved: new Map(),
  };
}

function stateOf(sim: Sim, api: SimApi): F10State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim, api);
    STATE.set(sim, st);
  }
  return st;
}

/** Посты этажа — для тестов. */
export const f10Posts = (sim: Sim): readonly Post[] => STATE.get(sim)?.posts ?? [];
/** Состояние событий — для тестов и стенда. */
export const f10Events = (sim: Sim) => {
  const st = STATE.get(sim);
  return st
    ? {
        bridge: st.bridgeState,
        storm: st.stormState,
        vault: st.vaultState,
        fragile: st.fragile,
        vaultDoor: st.vaultDoor,
        stormBox: st.stormBox,
      }
    : null;
};

function saveTile(
  sim: Sim,
  st: F10State,
  api: SimApi,
  i: number,
  tile: number,
  mark: number,
): void {
  const w = sim.world;
  if (!st.saved.has(i)) st.saved.set(i, { tile: sim.tiles[i], mark: w.mark[i] });
  api.setTile(sim, i % w.w, Math.floor(i / w.w), tile, mark);
}

function restoreTile(sim: Sim, st: F10State, api: SimApi, i: number): void {
  const v = st.saved.get(i);
  if (!v) return;
  const w = sim.world;
  api.setTile(sim, i % w.w, Math.floor(i / w.w), v.tile, v.mark);
  st.saved.delete(i);
}

/** Посты: ставить караул, когда герой подходит. */
function stepPosts(sim: Sim, st: F10State, api: SimApi): void {
  const h = sim.hero;
  for (const p of st.posts) {
    if (p.dead) continue;
    if (p.mob) {
      const m = sim.mobs.find((x) => x.id === p.mob);
      if (m && m.mode !== 'dying' && m.mode !== 'escape') continue;
      if (m && (m.mode === 'dying' || m.mode === 'escape')) {
        p.dead = true;
        p.mob = 0;
        continue;
      }
      // Ушёл за край видимости и снят движком — встанет снова, когда вернёшься.
      p.mob = 0;
    }
    const d = hypot(p.x - h.x, p.y - h.y);
    // Горгулья — камень на постаменте: встаёт и на глазах (статуя), остальные — вне кадра.
    if (d > 16 || (d < 5 && p.kind !== 'f10_gargoyle')) continue;
    if (sim.boss?.state === 'fight' && api.inArena(sim, p.x, p.y)) continue;
    const m = api.spawnMob(sim, p.kind, p.x, p.y, { mode: p.mode });
    m.data.post = p.id;
    m.data.hx = p.x;
    m.data.hy = p.y;
    m.hx = p.x;
    m.hy = p.y;
    m.face = Math.PI / 2;
    if (p.chain) {
      m.data.chain = 1;
      m.data.px = p.chain.px;
      m.data.py = p.chain.py;
      m.data.len = 3.1;
      // Цепь — картинка на полу от столба к ошейнику.
      const z: ZoneIn & { mob: number; px: number; py: number; post: number } = {
        x: p.chain.px,
        y: p.chain.py,
        r: 0.4,
        life: 1e9,
        art: 'f10_chain',
        mob: m.id,
        px: p.chain.px,
        py: p.chain.py,
        post: p.id,
      };
      api.zone(sim, z);
    }
    if (p.look !== undefined) m.data.look = p.look;
    if (p.kind === 'f10_gargoyle') m.data.ghost = 1;
    p.mob = m.id;
  }
}

/** Шипы Врат: волна по рядам, метка до удара, ковёр между рядами — безопасно. */
const SPIKE = { period: 3, warn: 0.6, up: 0.7 };

function stepSpikes(sim: Sim, st: F10State, api: SimApi, dt: number): void {
  if (!st.spikes.length) return;
  const h = sim.hero;
  const near = st.spikes.some(
    (r) => Math.abs(r.y + 0.5 - h.y) < 12 && Math.abs((r.x0 + r.x1) / 2 + 0.5 - h.x) < 10,
  );
  if (!near) return;
  const t0 = st.spikeT;
  st.spikeT += dt;
  const t1 = st.spikeT;
  const W = sim.world.w;
  for (const r of st.spikes) {
    // Момент метки: фаза ряда минус предупреждение.
    const cyc = (t: number) => Math.floor((t - r.off) / SPIKE.period);
    if (cyc(t1) === cyc(t0)) continue;
    const y = r.y + 0.5;
    api.strike(sim, {
      shape: 'line',
      x: r.x0,
      y,
      r: r.x1 - r.x0 + 1,
      w: 0.5,
      ang: 0,
      warn: SPIKE.warn,
      dmg: rawShare(sim, 0.1),
      knock: 3,
      art: 'f10_spikewarn',
    });
    for (const i of r.cells)
      api.zone(sim, {
        x: (i % W) + 0.5,
        y: Math.floor(i / W) + 0.5,
        r: 0.5,
        warn: SPIKE.warn,
        life: SPIKE.up,
        dps: 0.14,
        art: 'f10_spikes',
      });
  }
}

/** Мост Врат: ветхий пролёт рушится за спиной, с того берега — рыцари. */
function stepBridge(sim: Sim, st: F10State, api: SimApi): void {
  if (!st.fragile.length) return;
  const h = sim.hero;
  const W = sim.world.w;
  const hx = Math.floor(h.x);
  const hy = Math.floor(h.y);
  const onFrag = st.fragile.includes(hy * W + hx);
  if (onFrag) st.bridgeOn = sim.time;
  switch (st.bridgeState) {
    case 'idle': {
      // Прошёл ветхий пролёт на север — доски за спиной трещат.
      const onBridge = sim.world.mark[hy * W + hx] === F10_MARK.bridge;
      if (
        onBridge &&
        hy < st.fragTop - 1 &&
        hx >= st.bridgeX0 &&
        hx <= st.bridgeX1 &&
        sim.time - st.bridgeOn < 5
      ) {
        st.bridgeState = 'crack';
        st.bridgeT = sim.time + 1.25;
        for (const i of st.fragile) saveTile(sim, st, api, i, T_FLOOR, F10_MARK.cracking);
        sim.events.push({
          t: 'boss',
          what: 'f10_bridge_trap',
          text: 'МОСТ РУШИТСЯ',
          sub: 'рыцари ада на том берегу — вперёд',
        });
        // Рыцари — с того берега, скачут на мост.
        for (const [x, y] of st.knightSpot) {
          const m = api.spawnMob(sim, 'f10_knight', x, y, { mode: 'chase' });
          m.cd = 1.2;
          m.rush = true;
          st.bridgeKnights.push(m.id);
          sim.events.push({ t: 'emerge', x, y });
        }
      }
      return;
    }
    case 'crack': {
      if (sim.time < st.bridgeT) return;
      // Рушатся доски, на которых героя нет; на его доске — когда сойдёт.
      let left = 0;
      for (const i of st.fragile) {
        if (sim.tiles[i] === T_DEEP) continue;
        const x = i % W;
        const y = Math.floor(i / W);
        if (Math.abs(h.x - x - 0.5) < 0.5 + h.r && Math.abs(h.y - y - 0.5) < 0.5 + h.r) {
          left += 1;
          continue;
        }
        api.setTile(sim, x, y, T_DEEP, F10_MARK.fallen);
        for (const m of sim.mobs)
          if (
            m.mode !== 'dying' &&
            !MOB_FLY.has(m.kind) &&
            Math.floor(m.x) === x &&
            Math.floor(m.y) === y
          )
            api.fall(sim, m);
      }
      if (!left) {
        st.bridgeState = 'fallen';
        st.bridgeT = sim.time + 40;
        sim.events.push({
          t: 'boom',
          x: (st.bridgeX0 + st.bridgeX1) / 2 + 0.5,
          y: st.fragTop + 4,
          r: 0,
        });
      }
      return;
    }
    case 'fallen': {
      // Рыцари кончились (или минуло 40 с) — через 3 с доски вернутся.
      if (!st.bridgeKnights.length) return;
      const alive = st.bridgeKnights.some((id) =>
        sim.mobs.some((m) => m.id === id && m.mode !== 'dying' && m.mode !== 'escape'),
      );
      if (alive && sim.time < st.bridgeT) return;
      st.bridgeKnights = [];
      st.bridgeT = sim.time + 3;
      return;
    }
    case 'done':
      return;
  }
}

/** Доски возвращаются: цепи подтягивают пролёт, когда рыцарей нет. */
function stepBridgeMend(sim: Sim, st: F10State, api: SimApi): void {
  if (st.bridgeState !== 'fallen' || st.bridgeKnights.length || sim.time < st.bridgeT) return;
  const W = sim.world.w;
  for (const i of st.fragile) {
    restoreTile(sim, st, api, i);
    api.zone(sim, {
      x: (i % W) + 0.5,
      y: Math.floor(i / W) + 0.5,
      r: 0.5,
      life: 0.8,
      art: 'f10_mend',
    });
  }
  st.bridgeState = 'done';
  sim.events.push({
    t: 'boss',
    what: 'f10_mend_call',
    text: 'ЦЕПИ ЗАСКРЕЖЕТАЛИ',
    sub: 'мост снова цел',
  });
}

/** Гроза в Витражном зале: волны молний с безопасными клетками. */
const STORM = { waves: 9, every: 1.55, warn: 1.05 };

function stormWave(sim: Sim, st: F10State, api: SimApi): void {
  const [x0, y0, x1, y1] = st.stormBox;
  const h = sim.hero;
  const n = st.stormWave;
  const dmg = rawShare(sim, 0.13);
  const kind = n % 4;
  if (kind === 0 || kind === 2) {
    // Полосы в две клетки через две: поперёк, потом вдоль.
    const across = kind === 0;
    const off = (n >> 1) % 2 ? 2 : 0;
    for (let v = (across ? y0 : x0) + off; v <= (across ? y1 : x1); v += 4)
      api.strike(sim, {
        shape: 'line',
        x: across ? x0 : v + 1,
        y: across ? v + 1 : y0,
        r: across ? x1 - x0 + 1 : y1 - y0 + 1,
        w: 1,
        ang: across ? 0 : Math.PI / 2,
        warn: STORM.warn,
        dmg,
        knock: 3,
        art: 'f10_bolt_line',
      });
  } else if (kind === 1) {
    // Шахматка 3×3.
    for (let y = y0; y <= y1; y += 3)
      for (let x = x0; x <= x1; x += 3) {
        if ((Math.floor((x - x0) / 3) + Math.floor((y - y0) / 3) + (n >> 2)) % 2) continue;
        api.strike(sim, {
          shape: 'circle',
          x: x + 1.5,
          y: y + 1.5,
          r: 1.45,
          warn: STORM.warn,
          dmg,
          knock: 3,
          art: 'f10_bolt',
        });
      }
  } else {
    // Кольцо вокруг героя: стоять — нельзя, выйти — наружу или внутрь.
    api.strike(sim, {
      shape: 'ring',
      x: h.x,
      y: h.y,
      r: 2.4,
      w: 0.8,
      warn: STORM.warn,
      dmg,
      knock: 3,
      art: 'f10_bolt_ring',
    });
    api.strike(sim, {
      shape: 'circle',
      x: h.x,
      y: h.y,
      r: 0.9,
      warn: STORM.warn + 0.5,
      dmg,
      knock: 3,
      art: 'f10_bolt',
    });
  }
  // Стёкла сыплются у северной стены.
  for (const wi of st.stormWindows) {
    if (sim.rng() > 0.45) continue;
    const W = sim.world.w;
    api.strike(sim, {
      shape: 'circle',
      x: (wi % W) + 0.5 + (sim.rng() - 0.5),
      y: Math.floor(wi / W) + 1.5 + sim.rng() * 1.5,
      r: 0.7,
      warn: 0.8,
      dmg: dmg * 0.8,
      knock: 2,
      art: 'f10_glass',
    });
  }
  F10_FX.storm = performance.now() / 1000 + 0.5;
  sim.events.push({ t: 'boss', what: 'f10_storm_wall' });
}

function stepStorm(sim: Sim, st: F10State, api: SimApi): void {
  if (!st.storm.length) return;
  const h = sim.hero;
  const W = sim.world.w;
  const here = sim.world.mark[Math.floor(h.y) * W + Math.floor(h.x)] === F10_MARK.storm;
  switch (st.stormState) {
    case 'idle':
    case 'rest':
      if (st.stormState === 'rest' && sim.time < st.stormT) return;
      if (!here) return;
      // Вошёл глубже порога — гроза.
      if (Math.floor(h.y) > st.stormBox[3] - 2) return;
      st.stormState = 'on';
      st.stormWave = 0;
      st.stormNext = sim.time + 1.2;
      sim.events.push({
        t: 'boss',
        what: 'f10_storm_trap',
        text: 'ГРОЗА',
        sub: 'молнии бьют по клеткам — смотри метки',
      });
      return;
    case 'on': {
      // Выбежал из зала — гроза стихает без добычи и ждёт следующего раза.
      const [bx0, by0, bx1, by1] = st.stormBox;
      const inside = h.x > bx0 - 1 && h.x < bx1 + 2 && h.y > by0 - 1 && h.y < by1 + 2;
      if (!inside) {
        st.stormOut = st.stormOut || sim.time;
        if (sim.time - st.stormOut > 2) {
          st.stormState = 'rest';
          st.stormT = sim.time + 30;
          st.stormOut = 0;
        }
        return;
      }
      st.stormOut = 0;
      if (sim.time < st.stormNext) return;
      if (st.stormWave >= STORM.waves) {
        st.stormState = 'rest';
        st.stormT = sim.time + 150;
        // Окна выбиты, на полу — то, что гроза вынесла из стен.
        for (const wi of st.stormWindows) saveTile(sim, st, api, wi, T_WALL, F10_MARK.broken);
        const [x0, y0, x1, y1] = st.stormBox;
        const cx = (x0 + x1) / 2 + 0.5;
        const cy = (y0 + y1) / 2 + 0.5;
        // Добыча — раз за вылазку: иначе зал фармился бы каждые 2,5 минуты.
        if (!st.stormPaid) {
          st.stormPaid = true;
          for (let i = 0; i < 6; i++) api.dropAt(sim, 'coin', 120, cx, cy);
          for (let i = 0; i < 3; i++) api.dropAt(sim, 'token', 2, cx, cy);
          api.dropAt(sim, 'f10_sigil', 1, cx, cy);
          sim.events.push({
            t: 'boss',
            what: 'f10_calm_call',
            text: 'ГРОЗА СТИХЛА',
            sub: 'витражи выбиты — на полу добыча',
          });
        } else sim.events.push({ t: 'boss', what: 'f10_calm_call', text: 'ГРОЗА СТИХЛА' });
        return;
      }
      stormWave(sim, st, api);
      // На вспышках из тьмы выходят маги.
      if (st.stormWave === 2 || st.stormWave === 5) {
        const [x0, y0, x1, y1] = st.stormBox;
        const x = h.x < (x0 + x1) / 2 ? x1 - 1.5 : x0 + 1.5;
        const y = h.y < (y0 + y1) / 2 ? y1 - 1.5 : y0 + 1.5;
        if (!api.solidTile(sim, Math.floor(x), Math.floor(y))) {
          const m = api.spawnMob(sim, 'f10_mage', x, y, { mode: 'recover' });
          m.cd = 1.5;
          sim.events.push({ t: 'emerge', x, y });
        }
      }
      st.stormWave += 1;
      st.stormNext = sim.time + STORM.every;
      return;
    }
  }
}

/** Сокровищница: открыл сундук — решётка на дверь, горгульи оживают. */
function stepVault(sim: Sim, st: F10State, api: SimApi): void {
  const chest = st.vaultChest;
  if (!chest) return;
  const W = sim.world.w;
  switch (st.vaultState) {
    case 'idle': {
      if (!chest.on) return;
      const garg = st.posts.filter((p) => p.vault && !p.dead);
      if (!garg.length) {
        st.vaultState = 'done';
        return;
      }
      st.vaultState = 'shut';
      st.vaultT = sim.time + 90;
      for (const i of st.vaultDoor) {
        saveTile(sim, st, api, i, T_WALL, F10_MARK.bars);
        api.zone(sim, {
          x: (i % W) + 0.5,
          y: Math.floor(i / W) + 0.5,
          r: 0.5,
          life: 0.5,
          art: 'f10_barsfall',
        });
      }
      // Оживают по очереди, с первой — через 0,6 с.
      garg.forEach((p, n) => {
        let m = p.mob ? sim.mobs.find((x) => x.id === p.mob) : undefined;
        if (!m) {
          m = api.spawnMob(sim, 'f10_gargoyle', p.x, p.y, { mode: 'f10_stone' });
          m.data.post = p.id;
          m.data.hx = p.x;
          m.data.hy = p.y;
          m.data.ghost = 1;
          p.mob = m.id;
        }
        m.data.wakeAt = sim.time + 0.6 + n * 0.45;
      });
      sim.events.push({
        t: 'boss',
        what: 'f10_vault_trap',
        text: 'ЛОВУШКА',
        sub: 'решётка упала — горгульи ожили',
      });
      return;
    }
    case 'shut': {
      const alive = st.posts.some((p) => p.vault && !p.dead);
      const h = sim.hero;
      // Решётка поднимается, когда горгулий нет (или прошло полторы минуты).
      if (alive && sim.time < st.vaultT && !heroDown(sim)) return;
      for (const i of st.vaultDoor) {
        // Не поднимать на герое — он не может стоять в стене, но на всякий случай.
        void h;
        restoreTile(sim, st, api, i);
      }
      st.vaultState = 'done';
      sim.events.push({
        t: 'boss',
        what: 'f10_bars_call',
        text: 'РЕШЁТКА ПОДНЯЛАСЬ',
        sub: 'сокровищница твоя',
      });
      return;
    }
    case 'done':
      return;
  }
}

/** Печать мага: липнет к герою, потом отстаёт и бьёт молнией. */
function stepSigils(sim: Sim, api: SimApi, dt: number): void {
  const h = sim.hero;
  const kf = 1 - Math.exp(-dt * 14);
  const kd = 1 - Math.exp(-dt * 6);
  const st = STATE.get(sim);
  for (const z of sim.zones) {
    const zz = z as typeof z & { follow?: number; mob?: number; fired?: number };
    if (z.art === 'f10_sigil') {
      if (zz.follow && z.t < z.life - 0.5) {
        z.x += (h.x - z.x) * kf;
        z.y += (h.y - z.y) * kf;
      } else if (!zz.fired) {
        zz.fired = 1;
        zz.follow = 0;
        const from = sim.mobs.find((m) => m.id === zz.mob && m.mode !== 'dying');
        api.strike(sim, {
          shape: 'circle',
          x: z.x,
          y: z.y,
          r: 1.05,
          warn: 0.5,
          dmg: (from?.dmg ?? rawShare(sim, 0.1)) * 1.4,
          knock: 4,
          art: 'f10_bolt',
          from: from?.id,
        });
      }
    } else if (z.art === 'f10_divemark' && zz.follow) {
      z.x += (h.x - z.x) * kd;
      z.y += (h.y - z.y) * kd;
    } else if (z.art === 'f10_chain') {
      // Цепь тянется за псом; пёс умер — цепь лежит.
      const m = sim.mobs.find((x) => x.id === zz.mob);
      const c = z as typeof z & { mx?: number; my?: number; post?: number };
      if (m) {
        c.mx = m.x;
        c.my = m.y;
      } else if (!st?.posts.some((p) => p.id === c.post && p.dead)) {
        // Пса сняли (ушёл далеко) — цепь уберётся; убит — лежит на полу.
        z.life = 0;
        z.t = 1e9;
      }
    }
  }
}

/** Летуны не падают в пропасть. */
const MOB_FLY = new Set(['f10_succubus']);

registerFloor(10, {
  start(sim, api) {
    STATE.set(sim, scan(sim, api));
    API_REF.api = api;
  },
  step(sim, dt, api) {
    API_REF.api = api;
    const st = stateOf(sim, api);
    stepSigils(sim, api, dt);
    if (heroDown(sim)) return;
    stepPosts(sim, st, api);
    stepSpikes(sim, st, api, dt);
    stepBridge(sim, st, api);
    stepBridgeMend(sim, st, api);
    stepStorm(sim, st, api);
    stepVault(sim, st, api);
    // Эмблема трона на полу арены — картинка, без действия.
    const lair = sim.boss?.obj;
    if (lair && !sim.zones.some((z) => z.art === 'f10_emblem'))
      api.zone(sim, { x: lair.x + 0.5, y: lair.y + 4.5, r: 2.2, life: 1e9, art: 'f10_emblem' });
  },
});
