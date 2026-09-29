// Этаж 1 «Крысиные норы» — ИИ монстров, сценарий Крысиного короля 2.0 и
// правила этажа (v2.81).
//
// Крысолюды — не перекрашенные крысы, у каждого свой глагол:
//   • крысолюд с заточкой обходит по кругу, делает ЛОЖНЫЙ замах (линия на
//     полу наливается наполовину и гаснет, он отскакивает вбок) и только
//     потом выпад — линия наливается до конца; после выпада открыт;
//   • пращник держится за спинами своих и кидает камень НАВЕСОМ: на полу
//     горит метка приземления, отойди из круга;
//   • шаман не бьёт: прячется за стаей и колдует — лечит, ускоряет,
//     бодрит. Колдовство видно кругом на полу, удар по шаману его сбивает;
//   • латник из мусора закрыт спереди крышкой от котла: удар в щит звенит
//     и почти не ранит. Бей со спины, после тарана (он пролетает мимо и
//     стоит спиной) или когда он оглушён о стену.
//
// Правила этажа (`registerFloor(1)`): капканы (зажимают ногу — вырвись
// рывком или разбей тремя ударами; крысы попадаются в них тоже), растяжки
// (камнепад с метками) и гремушки (тревога — сбегается нора), обе можно
// перепрыгнуть рывком; Зал черепов — засада: устье заваливает, три волны,
// потом завал разбирают и у сердца зала лежит награда. Чары шамана (время
// действия, возврат скорости и урона) и броня латника — тоже здесь: они
// обязаны работать в любом режиме моба, а ИИ зовут не во всех.
//
// Король 2.0 — четыре полосы здоровья (как у босса первого этажа SAO):
//   I   тесак и крышка: перекат клубком (линия), удар тесаком (конус),
//       хлыст хвостами (кольцо);
//   II  «СТРАЖА»: из нор арены выходят латники; король зовёт стаю;
//   III «УЗЕЛ ЛОПНУЛ» (ровно на половине): от хвостов отрываются два малых
//       короля и дерутся рядом;
//   IV  «СМЕНА ОРУЖИЯ»: бросает тесак и выхватывает рельс-двуручник —
//       тройной взмах (три конуса подряд, каждый видно) и прыжок с ударом
//       (круг в месте падения, за ним — волна кольцом). Перекатов больше нет.
// Корона падает одна — из сундука босса (у моба короля её больше нет).

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi } from '../dungeon-ai';
import type { BossFight, Burrow, Mob, Prop, Sim } from '../dungeon-sim';
import { F1_MARK } from './f1';

const TAU = Math.PI * 2;

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
};

/** Уровень района по мировому ряду — ловушки бьют сильнее глубже. */
function levelAt(sim: Sim, y: number): number {
  const w = sim.world;
  const yy = Math.max(0, Math.min(w.h - 1, Math.floor(y)));
  for (const b of w.bands) if (yy >= b.top && yy < b.top + b.h) return b.def.level;
  return 0;
}

const lvlDmg = (sim: Sim, y: number) => Math.pow(1.7, levelAt(sim, y));

const alive = (m: Mob) =>
  m.mode !== 'dying' && m.mode !== 'escape' && m.mode !== 'emerge' && m.t >= 0;

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';

/** Крысы — звери без ума: они и попадаются в капканы. Крысолюды свои ловушки знают. */
const DUMB = new Set(['rat', 'fatrat', 'bomber', 'goldrat']);

// ---------------------------------------------------------------------------
// Состояние этажа в вылазке: ловушки, растяжки, Зал черепов, чары.
// ---------------------------------------------------------------------------

interface Trap {
  p: Prop;
  x: number;
  y: number;
  state: 'armed' | 'shut' | 'broken';
  /** Визуал захлопнутого капкана — лужа-рисунок без действия. */
  zone: number;
}

interface Wire {
  kind: 'rock' | 'rattle';
  props: Prop[];
  cells: Set<number>;
  live: boolean;
}

interface Hall {
  q: { x: number; y: number };
  doors: number[];
  cells: Set<number>;
  burrows: Burrow[];
  state: 'idle' | 'on' | 'done';
  wave: number;
  t: number;
  waveT: number;
  mobs: number[];
  cleared: boolean;
}

interface Hold {
  trap: Trap;
  t: number;
  hits: number;
}

interface F1State {
  traps: Trap[];
  wires: Wire[];
  hall: Hall | null;
  /** Герой в капкане. */
  held: Hold | null;
  /** Кто из мобов в капкане: id → сколько осталось. */
  caught: Map<number, { trap: Trap; t: number }>;
  /** Круг колдовства шамана → id шамана: сбили — круг гаснет. */
  casts: Map<number, number>;
}

const STATE = new WeakMap<Sim, F1State>();

/** Черновик этажа для этой вылазки (для тестов и рисовальщика). */
export function f1State(sim: Sim): F1State | undefined {
  return STATE.get(sim);
}

function stateOf(sim: Sim): F1State {
  let s = STATE.get(sim);
  if (!s) {
    s = buildState(sim);
    STATE.set(sim, s);
  }
  return s;
}

function buildState(sim: Sim): F1State {
  const w = sim.world;
  const traps: Trap[] = [];
  const wireProps: Prop[] = [];
  for (const p of sim.props) {
    const ref = p.obj.ref;
    if (p.kind !== 'deco') continue;
    if (ref === 'f1_trap') traps.push({ p, x: p.x, y: p.y, state: 'armed', zone: -1 });
    if (ref === 'f1_wire' || ref === 'f1_rattle') wireProps.push(p);
  }
  // Растяжка — связная полоса клеток одного вида.
  const wires: Wire[] = [];
  const seen = new Set<Prop>();
  for (const p of wireProps) {
    if (seen.has(p)) continue;
    const kind = p.obj.ref === 'f1_wire' ? 'rock' : 'rattle';
    const wire: Wire = { kind, props: [], cells: new Set(), live: true };
    const q = [p];
    seen.add(p);
    while (q.length) {
      const c = q.pop()!;
      wire.props.push(c);
      wire.cells.add(c.obj.y * w.w + c.obj.x);
      for (const o of wireProps) {
        if (seen.has(o) || o.obj.ref !== p.obj.ref) continue;
        if (Math.abs(o.obj.x - c.obj.x) + Math.abs(o.obj.y - c.obj.y) === 1) {
          seen.add(o);
          q.push(o);
        }
      }
    }
    wires.push(wire);
  }
  return { traps, wires, hall: buildHall(sim), held: null, caught: new Map(), casts: new Map() };
}

/** Зал черепов: сердце, устье и пол зала (заливка от сердца без устья). */
function buildHall(sim: Sim): Hall | null {
  const w = sim.world;
  let q: { x: number; y: number } | null = null;
  const doors: number[] = [];
  for (let i = 0; i < w.mark.length; i++) {
    if (w.mark[i] === F1_MARK.heart) q = { x: i % w.w, y: Math.floor(i / w.w) };
    if (w.mark[i] === F1_MARK.mouth) doors.push(i);
  }
  if (!q || !doors.length) return null;
  const doorSet = new Set(doors);
  const cells = new Set<number>();
  const start = q.y * w.w + q.x;
  const stack = [start];
  cells.add(start);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const j = (y + dy) * w.w + x + dx;
      if (cells.has(j) || doorSet.has(j)) continue;
      const t = sim.tiles[j];
      // Проходимые клетки: пол, лужи, опасный пол (как `walkableTile`).
      if (t !== 2 && t !== 5 && t !== 12 && t !== 3 && t !== 4) continue;
      cells.add(j);
      stack.push(j);
    }
  }
  const burrows = sim.burrows.filter(
    (b) => b.obj.out && cells.has(b.obj.out[1] * w.w + b.obj.out[0]),
  );
  return {
    q,
    doors,
    cells,
    burrows,
    state: 'idle',
    wave: 0,
    t: 0,
    waveT: 0,
    mobs: [],
    cleared: false,
  };
}

// ---------------------------------------------------------------------------
// Капканы.
// ---------------------------------------------------------------------------

const TRAP_R = 0.42;
const TRAP_HOLD = 4;
const TRAP_HITS = 3;

function shutTrap(sim: Sim, tr: Trap, api: SimApi): void {
  tr.state = 'shut';
  tr.p.alive = false;
  // Захлопнутый капкан лежит рисунком на полу (лужа без действия).
  const id = sim.nextId;
  api.zone(sim, { x: tr.x, y: tr.y, r: 0.4, life: 1e6, art: 'f1_trap_shut' });
  tr.zone = id;
  sim.events.push({ t: 'clank', x: tr.x, y: tr.y });
}

function breakTrap(sim: Sim, tr: Trap): void {
  tr.state = 'broken';
  sim.zones = sim.zones.filter((z) => z.id !== tr.zone);
  sim.events.push({ t: 'break', x: tr.x, y: tr.y, kind: 'f1_trap' });
}

function stepTraps(sim: Sim, st: F1State, dt: number, api: SimApi): void {
  const h = sim.hero;
  // Герой в капкане: нога зажата. Рывок вырывает, три удара разбивают.
  if (st.held) {
    const hold = st.held;
    hold.t += dt;
    for (const e of sim.events) if (e.t === 'swing') hold.hits += e.heavy ? TRAP_HITS : 1;
    if (heroDown(sim) || h.mode === 'dash' || hold.t > TRAP_HOLD) {
      st.held = null;
    } else if (hold.hits >= TRAP_HITS) {
      breakTrap(sim, hold.trap);
      st.held = null;
    } else {
      api.heroStatus(sim, 'slow', 0.15, 0.88);
      // Тянет к капкану: цепь держит.
      const dx = hold.trap.x - h.x;
      const dy = hold.trap.y - h.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.18) {
        h.x += (dx / d) * Math.min(d - 0.18, dt * 3);
        h.y += (dy / d) * Math.min(d - 0.18, dt * 3);
      }
    }
  }
  // Пойманные мобы: стоят на месте, пока цепь держит.
  for (const [id, c] of st.caught) {
    const m = sim.mobs.find((x) => x.id === id);
    c.t -= dt;
    if (!m || m.mode === 'dying' || c.t <= 0) {
      st.caught.delete(id);
      if (m && m.mode === 'stun') api.setMode(m, 'chase');
      continue;
    }
    m.x = c.trap.x;
    m.y = c.trap.y;
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
    m.mode = 'stun';
    m.t = 0;
  }
  for (const tr of st.traps) {
    if (tr.state !== 'armed') continue;
    // Герой: наступил — капкан захлопнулся. Рывок над ним — пролетел.
    if (
      !heroDown(sim) &&
      h.mode !== 'dash' &&
      Math.hypot(h.x - tr.x, h.y - tr.y) < TRAP_R &&
      !st.held
    ) {
      shutTrap(sim, tr, api);
      st.held = { trap: tr, t: 0, hits: 0 };
      api.hurtHero(sim, 14 * lvlDmg(sim, tr.y), tr.x, tr.y, 0, undefined, {
        kind: 'stun',
        dur: 0.45,
      });
      sim.events.push({
        t: 'boss',
        what: 'f1_trap',
        text: 'КАПКАН',
        sub: 'рывок — вырваться, три удара — разбить',
      });
      continue;
    }
    // Крысы — звери: лезут прямо в капкан. Только рядом с героем, чтобы
    // ловушки не срабатывали в пустых штреках сами по себе.
    if (Math.hypot(h.x - tr.x, h.y - tr.y) > 9) continue;
    for (const m of sim.mobs) {
      if (!DUMB.has(m.kind) || !alive(m) || m.mode === 'drop' || m.mode === 'sleep') continue;
      if (Math.hypot(m.x - tr.x, m.y - tr.y) > 0.36) continue;
      shutTrap(sim, tr, api);
      const dmg = Math.min(m.hp - 1, m.maxHp * 0.45);
      if (dmg > 0) {
        m.hp -= dmg;
        sim.events.push({
          t: 'hit',
          x: m.x,
          y: m.y,
          dmg: Math.round(dmg),
          crit: false,
          kill: false,
          boss: false,
        });
      }
      m.flash = 0.15;
      st.caught.set(m.id, { trap: tr, t: 2.2 });
      sim.events.push({ t: 'squeak', x: m.x, y: m.y });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Растяжки и гремушки.
// ---------------------------------------------------------------------------

/** Клетки пола вокруг точки — куда падают камни. */
function floorAround(sim: Sim, x: number, y: number, r: number, api: SimApi): [number, number][] {
  const out: [number, number][] = [];
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const cx = Math.floor(x) + dx;
      const cy = Math.floor(y) + dy;
      if (api.solidTile(sim, cx, cy)) continue;
      out.push([cx + 0.5, cy + 0.5]);
    }
  return out;
}

function rockfall(sim: Sim, x: number, y: number, api: SimApi): void {
  const k = lvlDmg(sim, y);
  const h = sim.hero;
  // Первый камень — точно в героя: метка под ногами, секунда на отход.
  api.strike(sim, {
    shape: 'circle',
    x: h.x,
    y: h.y,
    r: 0.85,
    warn: 0.95,
    dmg: 20 * k,
    knock: 3,
    art: 'f1_rock',
  });
  const cells = floorAround(sim, x, y, 3.2, api);
  for (let i = 0; i < 6 && cells.length; i++) {
    const j = Math.floor(sim.rng() * cells.length);
    const [cx, cy] = cells.splice(j, 1)[0];
    if (Math.hypot(cx - h.x, cy - h.y) < 1.2) continue;
    api.strike(sim, {
      shape: 'circle',
      x: cx + (sim.rng() - 0.5) * 0.4,
      y: cy + (sim.rng() - 0.5) * 0.4,
      r: 0.8,
      warn: 1.05 + i * 0.12,
      dmg: 20 * k,
      knock: 3,
      art: 'f1_rock',
    });
  }
}

function alarm(sim: Sim, x: number, y: number, api: SimApi): void {
  const h = sim.hero;
  // Спящие рядом просыпаются.
  for (const m of sim.mobs)
    if (m.mode === 'sleep' && Math.hypot(m.x - x, m.y - y) < 14) api.setMode(m, 'alert');
  const deep = levelAt(sim, y) > 0;
  const kinds = deep
    ? ['f1_ratman', 'rat', 'rat', 'f1_slinger', 'rat']
    : ['f1_ratman', 'rat', 'rat', 'rat'];
  for (let n = 0; n < 2; n++) {
    const b = api.pickBurrow(sim, 4, 15);
    if (!b) break;
    b.cd = 0;
    for (let i = n; i < kinds.length; i += 2) {
      const m = api.fromBurrow(sim, b, kinds[i], { rush: true });
      m.t = -i * 0.3;
    }
  }
  sim.director.intensity = Math.max(sim.director.intensity, 0.6);
  sim.events.push({ t: 'squeak', x: h.x, y: h.y });
}

function stepWires(sim: Sim, st: F1State, api: SimApi): void {
  const h = sim.hero;
  if (heroDown(sim) || h.mode === 'dash') return;
  const cell = Math.floor(h.y) * sim.world.w + Math.floor(h.x);
  for (const wr of st.wires) {
    if (!wr.live || !wr.cells.has(cell)) continue;
    wr.live = false;
    for (const p of wr.props) {
      p.alive = false;
      api.zone(sim, {
        x: p.x,
        y: p.y,
        r: 0.4,
        life: 1e6,
        art: wr.kind === 'rock' ? 'f1_wire_cut' : 'f1_rattle_cut',
      });
    }
    if (wr.kind === 'rock') {
      sim.events.push({
        t: 'boss',
        what: 'f1_wire',
        text: 'РАСТЯЖКА',
        sub: 'сверху сыплются камни — прочь из-под меток',
      });
      sim.events.push({ t: 'boom', x: h.x, y: h.y, r: 0 });
      rockfall(sim, h.x, h.y, api);
    } else {
      sim.events.push({
        t: 'boss',
        what: 'f1_rattle',
        text: 'ТРЕВОГА',
        sub: 'гремушка подняла нору',
      });
      alarm(sim, h.x, h.y, api);
    }
  }
}

// ---------------------------------------------------------------------------
// Зал черепов — засада Goblin Slayer: вошёл в сердце зала — устье
// заваливает, из нор лезут три волны. Выстоял — завал разбирают, у сердца
// лежит награда. Один раз за вылазку.
// ---------------------------------------------------------------------------

const RUBBLE = 9;
const FLOOR = 2;

const HALL_WAVES: string[][] = [
  ['rat', 'rat', 'rat', 'rat', 'f1_slinger', 'rat'],
  ['f1_ratman', 'f1_shaman', 'rat', 'f1_ratman', 'rat'],
  ['f1_guard', 'f1_ratman', 'f1_slinger', 'rat', 'rat'],
];

function hallSpawn(sim: Sim, hall: Hall, kinds: string[], api: SimApi): void {
  const h = sim.hero;
  const holes = [...hall.burrows].sort(() => sim.rng() - 0.5);
  kinds.forEach((kind, i) => {
    let m: Mob;
    // Половина — из нор зала, остальные падают со свода вокруг героя.
    if (holes.length && i % 2 === 0) {
      const b = holes[i % holes.length];
      b.cd = 0;
      m = api.fromBurrow(sim, b, kind, { rush: true });
      m.t = -i * 0.25;
    } else {
      const cells = floorAround(sim, h.x, h.y, 4.5, api).filter(
        ([x, y]) =>
          Math.hypot(x - h.x, y - h.y) > 2.2 &&
          hall.cells.has(Math.floor(y) * sim.world.w + Math.floor(x)),
      );
      const [x, y] = cells.length ? cells[Math.floor(sim.rng() * cells.length)] : [h.x + 2, h.y];
      m = api.spawnMob(sim, kind, x, y, { mode: 'drop' });
      m.t = -i * 0.2;
    }
    m.data.f1hall = 1;
    hall.mobs.push(m.id);
  });
}

function setDoors(sim: Sim, hall: Hall, tile: number): void {
  for (const i of hall.doors) sim.tiles[i] = tile;
  for (const i of hall.doors) {
    const x = (i % sim.world.w) + 0.5;
    const y = Math.floor(i / sim.world.w) + 0.5;
    sim.events.push({ t: 'boom', x, y, r: 0 });
  }
}

function stepHall(sim: Sim, st: F1State, dt: number, api: SimApi): void {
  const hall = st.hall;
  if (!hall || hall.state === 'done') return;
  const h = sim.hero;
  if (hall.state === 'idle') {
    if (heroDown(sim)) return;
    if (Math.hypot(h.x - hall.q.x - 0.5, h.y - hall.q.y - 0.5) > 1.6) return;
    // Никого в устье — завал не упадёт на голову.
    const w = sim.world.w;
    for (const i of hall.doors)
      if (Math.hypot((i % w) + 0.5 - h.x, Math.floor(i / w) + 0.5 - h.y) < 1.2) return;
    hall.state = 'on';
    hall.t = 0;
    hall.wave = 0;
    hall.waveT = 1;
    setDoors(sim, hall, RUBBLE);
    // Кто стоял в устье — внутрь, не в завал.
    for (const m of sim.mobs) api.collide(sim, m);
    sim.events.push({
      t: 'boss',
      what: 'f1_hall',
      text: 'ЗАСАДА',
      sub: 'устье завалило — выстой три волны',
    });
    sim.hitstop = Math.max(sim.hitstop, 0.1);
    return;
  }
  // Идёт засада.
  hall.t += dt;
  if (heroDown(sim)) return;
  hall.waveT -= dt;
  const left = hall.mobs.filter((id) => sim.mobs.some((m) => m.id === id && m.mode !== 'dying'));
  hall.mobs = left;
  if (hall.wave < HALL_WAVES.length) {
    if ((left.length <= 1 && hall.waveT <= 0) || (hall.waveT <= -25 && hall.wave > 0)) {
      hallSpawn(sim, hall, HALL_WAVES[hall.wave], api);
      hall.wave += 1;
      hall.waveT = 1.5;
      if (hall.wave > 1)
        sim.events.push({
          t: 'boss',
          what: 'f1_wave',
          text: `ВОЛНА ${hall.wave}`,
          sub: hall.wave === 3 ? 'латник — бей со спины' : 'шаман — убей первым',
        });
      else sim.events.push({ t: 'squeak', x: h.x, y: h.y });
    }
    return;
  }
  // Все волны вышли: зал взят, когда никого не осталось (или вышло время).
  if (left.length === 0 || hall.t > 150) {
    hall.state = 'done';
    hall.cleared = left.length === 0;
    setDoors(sim, hall, FLOOR);
    const x = hall.q.x + 0.5;
    const y = hall.q.y + 0.5;
    if (hall.cleared) {
      const k = 1 + levelAt(sim, y);
      for (let i = 0; i < 6; i++) api.dropAt(sim, 'coin', 60 * k, x, y);
      for (let i = 0; i < 5; i++) api.dropAt(sim, 'token', 2, x, y);
      if (sim.rng() < 0.5) api.dropAt(sim, 'key', 1, x, y);
      api.dropAt(sim, 'f1_charm', 1, x, y);
      for (let i = 0; i < 3; i++) api.dropAt(sim, 'skin', 1, x, y);
    }
    sim.events.push({
      t: 'boss',
      what: 'f1_hall_done',
      text: hall.cleared ? 'ЗАЛ ВЗЯТ' : 'ЗАВАЛ РАЗОБРАН',
      sub: hall.cleared ? 'награда у сердца зала' : 'крысы разбежались',
    });
  }
}

// ---------------------------------------------------------------------------
// Чары шамана: время действия и возврат. Метка для рисовальщика —
// `m.data.f1buff` (1 — прыть, 2 — ярость, 4 — лечение).
// ---------------------------------------------------------------------------

function stepBuffs(sim: Sim, st: F1State, dt: number): void {
  for (const m of sim.mobs) {
    const d = m.data;
    if (!d.f1buff && !d.f1hasteT && !d.f1rageT && !d.f1healT) continue;
    let buff = 0;
    if (d.f1hasteT) {
      d.f1hasteT -= dt;
      if (d.f1hasteT <= 0) {
        m.speed = d.f1spd ?? m.speed;
        d.f1hasteT = 0;
      } else buff |= 1;
    }
    if (d.f1rageT) {
      d.f1rageT -= dt;
      if (d.f1rageT <= 0) {
        m.dmg = d.f1dmg ?? m.dmg;
        d.f1rageT = 0;
      } else buff |= 2;
    }
    if (d.f1healT) {
      d.f1healT -= dt;
      if (d.f1healT <= 0) d.f1healT = 0;
      else buff |= 4;
    }
    d.f1buff = buff;
  }
  // Сбили шамана — его круг гаснет.
  for (const [zid, mid] of st.casts) {
    const m = sim.mobs.find((x) => x.id === mid);
    if (m && m.mode === 'cast') continue;
    sim.zones = sim.zones.filter((z) => z.id !== zid);
    st.casts.delete(zid);
  }
}

// ---------------------------------------------------------------------------
// Броня латника: удар в щит звенит. Считаем по событиям удара этого шага:
// взрывы и вагонетки событий удара не дают — они бьют латника в полную.
// ---------------------------------------------------------------------------

/** Латник закрыт щитом в этих режимах. */
const SHIELD_UP = new Set(['chase', 'windup', 'bashAim', 'bash', 'alert']);
/** Полураствор щита, рад: удар ближе к взгляду латника — в щит. */
const SHIELD_ARC = 1.15;

function stepArmor(sim: Sim): void {
  const h = sim.hero;
  for (const e of sim.events) {
    if (e.t !== 'hit' || e.dmg <= 0) continue;
    for (const m of sim.mobs) {
      if (m.kind !== 'f1_guard' || m.mode === 'dying') continue;
      if (e.x !== m.x || e.y !== m.y) continue;
      if (!SHIELD_UP.has(m.mode)) break;
      const toHero = Math.atan2(h.y - m.y, h.x - m.x);
      if (Math.abs(angDiff(toHero, m.face)) > SHIELD_ARC) break;
      const keep = h.mode === 'heavy' ? 0.5 : 0.82;
      const back = e.dmg * keep;
      m.hp = Math.min(m.maxHp, m.hp + back);
      m.kx *= 0.25;
      m.ky *= 0.25;
      e.dmg = Math.max(1, Math.round(e.dmg - back));
      e.crit = false;
      sim.events.push({
        t: 'clank',
        x: m.x + Math.cos(m.face) * m.r,
        y: m.y + Math.sin(m.face) * m.r,
      });
      break;
    }
  }
}

/**
 * Удар сбивает свои замахи этажа (колдовство, праща, финт) так же, как
 * движок сбивает обычный замах: крит и тяжёлый — всегда, обычный — с долей
 * `flinch` вида. Движок знает только свои режимы, свои — здесь.
 */
const INTERRUPT = new Set(['cast', 'call', 'aim', 'feint', 'hop', 'lungeAim']);

function stepFlinch(sim: Sim, api: SimApi): void {
  const heavy = sim.hero.mode === 'heavy';
  for (const e of sim.events) {
    if (e.t !== 'hit' || e.dmg <= 0) continue;
    for (const m of sim.mobs) {
      if (e.x !== m.x || e.y !== m.y || !INTERRUPT.has(m.mode)) continue;
      const fl = api.def(m.kind).flinch ?? 0.35;
      if (e.crit || heavy || fl >= 1 || sim.rng() < fl) {
        m.tele = null;
        m.danger = 0;
        api.setMode(m, 'stun');
      }
      break;
    }
  }
}

registerFloor(1, {
  start(sim) {
    STATE.set(sim, buildState(sim));
  },
  step(sim, dt, api) {
    const st = stateOf(sim);
    stepArmor(sim);
    stepFlinch(sim, api);
    stepTraps(sim, st, dt, api);
    stepWires(sim, st, api);
    stepHall(sim, st, dt, api);
    stepBuffs(sim, st, dt);
  },
});

// ---------------------------------------------------------------------------
// Общие приёмы ИИ.
// ---------------------------------------------------------------------------

/** Ближний укус/тычок: режим `windup` (конус рисует движок), потом удар. */
function jab(sim: Sim, m: Mob, c: BrainCtx, api: SimApi, next = 'recover'): void {
  const h = sim.hero;
  m.vx *= 0.75;
  m.vy *= 0.75;
  if (m.t < c.def.windup) return;
  const reach = c.def.reach + m.r + h.r + 0.18;
  // Честно: бьёт только в нарисованный конус (±0,6 рад, как метка движка).
  const off = Math.abs(angDiff(Math.atan2(c.dy, c.dx), m.face));
  if (c.dist < reach && off < 0.6 + Math.atan(h.r / Math.max(0.1, c.dist)))
    api.hurtHero(sim, m.dmg, m.x, m.y, c.def.hit?.push ?? 2, m.kind);
  m.vx += Math.cos(m.face) * 2.5;
  m.vy += Math.sin(m.face) * 2.5;
  api.setMode(m, next);
  m.cd = c.def.rest * (0.8 + sim.rng() * 0.4);
}

/** Раненый зверь иногда удирает в свою нору. */
function maybeFlee(sim: Sim, m: Mob, api: SimApi): boolean {
  if (m.hp < m.maxHp * 0.3 && m.burrow >= 0 && sim.rng() < 0.3) {
    api.setMode(m, 'flee');
    return true;
  }
  return false;
}

function fleeHome(sim: Sim, m: Mob, dt: number, api: SimApi): void {
  const b = sim.burrows[m.burrow];
  if (!b || !b.obj.out) {
    api.setMode(m, 'chase');
    return;
  }
  const [ox, oy] = b.obj.out;
  const [cx, cy] = api.chaseDir(sim, m, ox + 0.5, oy + 0.5);
  api.steer(sim, m, cx, cy, m.speed * 1.1, dt);
  if (Math.hypot(ox + 0.5 - m.x, oy + 0.5 - m.y) < 0.45) {
    api.setMode(m, 'escape');
    m.hp = 0;
  }
  if (m.t > 4) api.setMode(m, 'chase');
}

// ---------------------------------------------------------------------------
// Крысолюд с заточкой: обход, финт, выпад.
// ---------------------------------------------------------------------------

const LUNGE_LEN = 2.4;
const LUNGE_V = 10;

registerBrain('f1_ratman', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.bounce = false;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (dist < 1.05 && m.cd <= 0) {
          api.setMode(m, 'windup');
          m.face = Math.atan2(dy, dx);
          return;
        }
        if (see && dist < 2.9 && dist > 1.2 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          m.face = m.dir;
          api.setMode(m, sim.rng() < 0.4 ? 'feint' : 'lungeAim');
          m.data.wu = 0.42;
          return;
        }
        // Обходит по кругу на расстоянии выпада: у каждого своя сторона.
        let tx = h.x;
        let ty = h.y;
        if (dist < 3.6 && see) {
          const side = m.id % 2 === 0 ? 1 : -1;
          const a = Math.atan2(m.y - h.y, m.x - h.x) + side * 0.8;
          tx = h.x + Math.cos(a) * 2.3;
          ty = h.y + Math.sin(a) * 2.3;
        }
        const [cx, cy] = api.chaseDir(sim, m, tx, ty);
        api.steer(sim, m, cx, cy, m.speed * (dist < 3.6 ? 0.8 : 1), dt);
        return;
      }
      case 'windup':
        jab(sim, m, c, api);
        return;
      case 'feint': {
        // Ложный замах: линия наливается наполовину и гаснет, он отскакивает.
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = m.dir;
        m.tele = { shape: 'line', r: LUNGE_LEN, w: 0.3, ang: m.dir, k: Math.min(0.5, m.t / 0.5) };
        if (m.t > 0.3) {
          const side = sim.rng() < 0.5 ? 1 : -1;
          m.vx = Math.cos(m.dir + (side * Math.PI) / 2) * 4.5;
          m.vy = Math.sin(m.dir + (side * Math.PI) / 2) * 4.5;
          m.tele = null;
          api.setMode(m, 'hop');
        }
        return;
      }
      case 'hop':
        m.vx *= 0.82;
        m.vy *= 0.82;
        if (m.t > 0.22) {
          m.dir = Math.atan2(dy, dx);
          m.data.wu = 0.34;
          api.setMode(m, 'lungeAim');
        }
        return;
      case 'lungeAim': {
        const wu = m.data.wu || 0.42;
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < wu * 0.55) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = { shape: 'line', r: LUNGE_LEN, w: 0.32, ang: m.dir, k: Math.min(1, m.t / wu) };
        if (m.t > wu - 0.22) m.danger = LUNGE_LEN + 0.6;
        if (m.t >= wu) {
          m.data.hit = 0;
          api.setMode(m, 'lunge');
        }
        return;
      }
      case 'lunge': {
        m.vx = Math.cos(m.dir) * LUNGE_V;
        m.vy = Math.sin(m.dir) * LUNGE_V;
        m.face = m.dir;
        m.bounce = true;
        m.danger = m.r + h.r + 0.6;
        if (!m.data.hit && dist < m.r + h.r + 0.25 && h.mode !== 'dash') {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.15, m.x, m.y, 4, m.kind);
        }
        if (m.t > LUNGE_LEN / LUNGE_V) {
          m.vx *= 0.3;
          m.vy *= 0.3;
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      }
      case 'recover':
        // Проскочил — стоит открытый.
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.55 && !maybeFlee(sim, m, api)) api.setMode(m, 'chase');
        return;
      case 'flee':
        fleeHome(sim, m, dt, api);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'lunge') return;
    m.bounce = false;
    sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
    api.setMode(m, 'recover');
    m.cd = 1.2;
  },
});

// ---------------------------------------------------------------------------
// Пращник: держится за спинами своих, камень навесом.
// ---------------------------------------------------------------------------

/** Ближайший свой, за которым можно спрятаться. */
function coverAlly(sim: Sim, m: Mob, r: number): Mob | null {
  let best: Mob | null = null;
  let bd = r;
  for (const o of sim.mobs) {
    if (o === m || !alive(o) || o.mode === 'sleep') continue;
    if (o.kind === 'f1_slinger' || o.kind === 'f1_shaman' || o.kind === 'king') continue;
    const d = Math.hypot(o.x - m.x, o.y - m.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** Дальше этого пращник не кидает. */
const SLING_RANGE = 7;

registerBrain('f1_slinger', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (dist < 1.0 && m.cd <= 0) {
          api.setMode(m, 'windup');
          m.face = Math.atan2(dy, dx);
          return;
        }
        if (m.cd <= 0 && dist > 2.2 && dist < SLING_RANGE && (see || dist < 4.5)) {
          api.setMode(m, 'aim');
          m.face = Math.atan2(dy, dx);
          return;
        }
        // Близко — отходит; иначе прячется за своими на линии от героя.
        if (dist < 2.3) {
          const away = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
          api.steer(sim, m, away[0], away[1], m.speed * 1.05, dt);
          return;
        }
        const ally = coverAlly(sim, m, 6);
        let tx: number;
        let ty: number;
        if (ally) {
          const ax = ally.x - h.x;
          const ay = ally.y - h.y;
          const al = Math.hypot(ax, ay) || 1;
          tx = ally.x + (ax / al) * 1.4;
          ty = ally.y + (ay / al) * 1.4;
        } else {
          tx = h.x - (dx / (dist || 1)) * 4.6;
          ty = h.y - (dy / (dist || 1)) * 4.6;
        }
        if (api.solidTile(sim, Math.floor(tx), Math.floor(ty))) {
          tx = h.x - (dx / (dist || 1)) * 4.6;
          ty = h.y - (dy / (dist || 1)) * 4.6;
        }
        const [cx, cy] = api.chaseDir(sim, m, tx, ty);
        const far = Math.hypot(tx - m.x, ty - m.y);
        api.steer(sim, m, cx, cy, far > 0.6 ? m.speed : 0, dt);
        m.face = Math.atan2(dy, dx);
        return;
      }
      case 'windup':
        jab(sim, m, c, api);
        return;
      case 'aim': {
        // Праща раскручивается над головой — видно, что сейчас полетит.
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = Math.atan2(dy, dx);
        if (m.t >= def.windup) {
          // Иногда кидает на упреждение: стоять столбом — не спасение.
          let tx = h.x;
          let ty = h.y;
          if (sim.rng() < 0.35) {
            const T = Math.max(0.35, dist / (def.shot?.speed ?? 7));
            tx += h.vx * T * 0.7;
            ty += h.vy * T * 0.7;
            if (api.solidTile(sim, Math.floor(tx), Math.floor(ty))) {
              tx = h.x;
              ty = h.y;
            }
          }
          api.shoot(sim, m, Math.atan2(ty - m.y, tx - m.x), def.shot, tx, ty);
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      }
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.45 && !maybeFlee(sim, m, api)) api.setMode(m, 'chase');
        return;
      case 'flee':
        fleeHome(sim, m, dt, api);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Шаман: прячется за стаей и колдует. Удар по нему сбивает колдовство.
// ---------------------------------------------------------------------------

const CAST_R = 4.5;

type Spell = 'heal' | 'haste' | 'rage';

function flock(sim: Sim, m: Mob, r: number): Mob[] {
  return sim.mobs.filter(
    (o) =>
      o !== m &&
      alive(o) &&
      o.mode !== 'sleep' &&
      o.kind !== 'f1_shaman' &&
      !isBoss(o) &&
      Math.hypot(o.x - m.x, o.y - m.y) < r,
  );
}

const isBoss = (o: Mob) => o.kind === 'king' || o.kind === 'kinglet';

function pickSpell(sim: Sim, m: Mob, allies: Mob[]): Spell {
  if (allies.some((o) => o.hp < o.maxHp * 0.6)) return 'heal';
  const last = m.data.spell ?? 0;
  const noHaste = allies.some((o) => !o.data.f1hasteT);
  const noRage = allies.some((o) => !o.data.f1rageT);
  if (noHaste && (last !== 2 || !noRage)) return 'haste';
  if (noRage) return 'rage';
  return sim.rng() < 0.5 ? 'haste' : 'heal';
}

function castSpell(sim: Sim, m: Mob, spell: Spell): void {
  for (const o of flock(sim, m, CAST_R)) {
    if (spell === 'heal') {
      o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.35);
      o.data.f1healT = 0.9;
    } else if (spell === 'haste') {
      if (!o.data.f1hasteT) o.data.f1spd = o.speed;
      o.speed = (o.data.f1spd ?? o.speed) * 1.45;
      o.data.f1hasteT = 6;
    } else {
      if (!o.data.f1rageT) o.data.f1dmg = o.dmg;
      o.dmg = (o.data.f1dmg ?? o.dmg) * 1.3;
      o.cd = 0;
      o.data.f1rageT = 6;
    }
    o.data.f1buff = (o.data.f1buff ?? 0) | (spell === 'heal' ? 4 : spell === 'haste' ? 1 : 2);
  }
  m.data.spell = spell === 'heal' ? 1 : spell === 'haste' ? 2 : 3;
}

registerBrain('f1_shaman', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.callCd = (m.data.callCd ?? 4) - dt;
    switch (m.mode) {
      case 'chase': {
        if (dist < 1.0 && m.cd <= 0) {
          api.setMode(m, 'windup');
          m.face = Math.atan2(dy, dx);
          return;
        }
        const allies = flock(sim, m, 7);
        if (
          m.cd <= 0 &&
          dist > 1.6 &&
          allies.some((o) => Math.hypot(o.x - m.x, o.y - m.y) < CAST_R)
        ) {
          const spell = pickSpell(sim, m, allies);
          m.data.cast = spell === 'heal' ? 1 : spell === 'haste' ? 2 : 3;
          api.setMode(m, 'cast');
          const zid = sim.nextId;
          api.zone(sim, {
            x: m.x,
            y: m.y,
            r: CAST_R,
            life: def.windup + 0.15,
            art: `f1_cast_${spell}`,
          });
          stateOf(sim).casts.set(zid, m.id);
          return;
        }
        if (!allies.length) {
          // Один — удирает и зовёт своих.
          if (m.data.callCd <= 0 && dist < 9) {
            api.setMode(m, 'call');
            return;
          }
          const away = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
          api.steer(sim, m, away[0], away[1], m.speed, dt);
          return;
        }
        // За спинами: позади середины стаи, подальше от героя.
        let cx = 0;
        let cy = 0;
        for (const o of allies) {
          cx += o.x;
          cy += o.y;
        }
        cx /= allies.length;
        cy /= allies.length;
        const ax = cx - h.x;
        const ay = cy - h.y;
        const al = Math.hypot(ax, ay) || 1;
        let tx = cx + (ax / al) * 2.2;
        let ty = cy + (ay / al) * 2.2;
        if (api.solidTile(sim, Math.floor(tx), Math.floor(ty))) {
          tx = cx;
          ty = cy;
        }
        const [sx, sy] =
          dist < 3.2
            ? (api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)])
            : api.chaseDir(sim, m, tx, ty);
        const far = Math.hypot(tx - m.x, ty - m.y);
        api.steer(sim, m, sx, sy, dist < 3.2 || far > 0.7 ? m.speed : 0, dt);
        m.face = Math.atan2(dy, dx);
        return;
      }
      case 'cast': {
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.face = Math.atan2(dy, dx);
        if (m.t >= def.windup) {
          const spell: Spell = m.data.cast === 1 ? 'heal' : m.data.cast === 2 ? 'haste' : 'rage';
          castSpell(sim, m, spell);
          sim.events.push({ t: 'squeak', x: m.x, y: m.y });
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.85 + sim.rng() * 0.3);
        }
        return;
      }
      case 'call': {
        m.vx *= 0.5;
        m.vy *= 0.5;
        if (m.t > 0.9) {
          const b = api.pickBurrow(sim, 3, 12);
          if (b) {
            b.cd = 0;
            for (let i = 0; i < 2; i++) {
              const r = api.fromBurrow(sim, b, 'rat', { rush: true });
              r.t = -i * 0.3;
            }
          }
          m.data.callCd = 12;
          sim.events.push({ t: 'squeak', x: m.x, y: m.y });
          api.setMode(m, 'chase');
        }
        return;
      }
      case 'windup':
        jab(sim, m, c, api);
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.5) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Латник из мусора: щит спереди, удар булавой, таран щитом.
// ---------------------------------------------------------------------------

const GUARD_TURN = 2.3;

registerBrain('f1_guard', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.bounce = false;
    m.data.bashCd = (m.data.bashCd ?? 1.5) - dt;
    // Взгляд (и щит) поворачивается медленно: забежал за спину — успеешь.
    const want = Math.atan2(dy, dx);
    const turn = (fa: number) => {
      const d = angDiff(want, fa);
      return fa + Math.max(-GUARD_TURN * dt, Math.min(GUARD_TURN * dt, d));
    };
    if (m.data.fa === undefined) m.data.fa = want;
    switch (m.mode) {
      case 'chase': {
        m.data.fa = turn(m.data.fa);
        if (dist < def.reach + m.r + h.r + 0.1 && m.cd <= 0) {
          api.setMode(m, 'windup');
          m.face = m.data.fa;
          return;
        }
        if (
          dist > 2.4 &&
          dist < 5.5 &&
          m.data.bashCd <= 0 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y)
        ) {
          m.dir = want;
          api.setMode(m, 'bashAim');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        m.face = m.data.fa;
        return;
      }
      case 'windup': {
        m.data.fa = turn(m.data.fa);
        m.face = m.data.fa;
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t >= def.windup) {
          const reach = def.reach + m.r + h.r + 0.2;
          const off = Math.abs(angDiff(want, m.face));
          if (dist < reach && off < 0.6 + Math.atan(h.r / Math.max(0.1, dist)))
            api.hurtHero(sim, m.dmg, m.x, m.y, 6, m.kind);
          sim.events.push({
            t: 'boom',
            x: m.x + Math.cos(m.face) * 0.8,
            y: m.y + Math.sin(m.face) * 0.8,
            r: 0,
          });
          api.setMode(m, 'recover');
          m.data.rec = 0.8;
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      }
      case 'bashAim': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < 0.45) m.dir = want;
        m.data.fa = m.dir;
        m.face = m.dir;
        m.tele = { shape: 'line', r: 4.4, w: m.r + 0.05, ang: m.dir, k: Math.min(1, m.t / 0.8) };
        if (m.t > 0.55) m.danger = 4.8;
        if (m.t >= 0.8) {
          m.data.hit = 0;
          api.setMode(m, 'bash');
        }
        return;
      }
      case 'bash': {
        const s = 8.5;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.bounce = true;
        m.danger = m.r + h.r + 1.2;
        if (!m.data.hit && dist < m.r + h.r + 0.1 && h.inv <= 0 && h.mode !== 'dash') {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.25, m.x, m.y, 9, m.kind);
          m.vx *= 0.2;
          m.vy *= 0.2;
          api.setMode(m, 'recover');
          m.data.rec = 0.8;
          m.data.bashCd = 5;
          return;
        }
        if (m.t > 0.55) {
          // Промахнулся — пролетел мимо и стоит к герою спиной.
          m.vx *= 0.2;
          m.vy *= 0.2;
          api.setMode(m, 'recover');
          m.data.rec = 1.15;
          m.data.bashCd = 5;
        }
        return;
      }
      case 'dizzy':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > 1.8) {
          m.data.fa = m.face;
          api.setMode(m, 'chase');
        }
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > (m.data.rec ?? 0.8)) {
          m.data.fa = m.face;
          api.setMode(m, 'chase');
        }
        return;
      default:
        m.data.fa = m.face;
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'bash') return;
    // В стену с разбегу — оглушён, щит опущен.
    m.bounce = false;
    m.danger = 0;
    sim.hitstop = Math.max(sim.hitstop, 0.06);
    sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
    sim.events.push({ t: 'clank', x: m.x, y: m.y });
    api.setMode(m, 'dizzy');
    m.data.bashCd = 5;
  },
});

// ---------------------------------------------------------------------------
// Крысиный король 2.0 и малые короли.
// ---------------------------------------------------------------------------

/** Пороги полос здоровья короля (доля его здоровья). */
export const KING_BARS = [0.75, 0.5, 0.25];
/**
 * Ярость: бой дольше этого — король бьёт чаще и больнее. Слабое снаряжение
 * упирается в неё раньше, чем в полосы: так Т1 проигрывает, а Т2+3 — нет.
 */
export const KING_RAGE = 150;
const KING_RAGE_DMG = 1.3;
/** Доля здоровья короля у каждого из двух малых. */
const KINGLET_SHARE = 0.12;

const kingOf = (sim: Sim) => sim.mobs.find((m) => m.kind === 'king' && m.mode !== 'dying');

/**
 * v2.85 — только рисунок: зона-картинка без урона и статусов (метка, контакт,
 * пыль — `f1-boss-fx.ts`). Кладётся мимо `api.zone`, чтобы не тратить
 * `sim.nextId`: от номеров мобов зависит, с какого бока заходит стая, а
 * картинка не должна менять бой. `lit` — вторая зона поверх темноты (`…L`).
 */
function vfx(
  sim: Sim,
  art: string,
  x: number,
  y: number,
  life: number,
  o: Record<string, number> = {},
  lit = false,
): void {
  const vSeed = Math.floor(sim.time * 1000 + x * 7919 + y * 131) % 1e6;
  const z = { x, y, r: 0.5, life, art, ...o, vSeed, id: 0, t: 0 };
  sim.zones.push(z);
  if (lit) sim.zones.push({ ...z, art: art + 'L', above: true });
}

function arenaHoles(sim: Sim, api: SimApi): Burrow[] {
  return sim.burrows.filter(
    (x) => x.obj.out && api.inArena(sim, x.obj.out[0] + 0.5, x.obj.out[1] + 0.5),
  );
}

/** Стража из нор арены: латники. Помечены — сброс боя их уберёт. */
function callGuards(sim: Sim, n: number, api: SimApi): void {
  const holes = arenaHoles(sim, api).sort(
    (a, b) =>
      Math.hypot(b.obj.x - sim.hero.x, b.obj.y - sim.hero.y) -
      Math.hypot(a.obj.x - sim.hero.x, a.obj.y - sim.hero.y),
  );
  for (let i = 0; i < n && holes.length; i++) {
    const hb = holes[i % holes.length];
    hb.cd = 0;
    const g = api.fromBurrow(sim, hb, 'f1_guard');
    g.t = -i * 0.4;
    g.data.f1boss = 1;
  }
}

function summonRats(sim: Sim, m: Mob, api: SimApi): void {
  const holes = arenaHoles(sim, api);
  const n = 3 + Math.floor(sim.rng() * 2);
  for (let i = 0; i < n && holes.length; i++) {
    const hb = holes[i % holes.length];
    hb.cd = 0;
    const mm = api.fromBurrow(sim, hb, 'rat', { elite: i === 0 && sim.rng() < 0.2 });
    mm.t = -i * 0.2;
    mm.data.f1boss = 1;
    // v2.85 — только рисунок: нора выплёвывает землю, когда крыса лезет.
    const [ox, oy] = hb.obj.out ?? [hb.obj.x, hb.obj.y];
    const at = { vDelay: i * 0.2, vDx: ox - hb.obj.x, vDy: oy - hb.obj.y };
    vfx(sim, 'f1_burst', (hb.obj.x + ox) / 2 + 0.5, (hb.obj.y + oy) / 2 + 0.5, 1.6 + i * 0.2, at);
  }
  m.summonCd = 12;
}

/** Хвосты рвутся: от короля отрываются два малых. */
function splitKing(sim: Sim, b: BossFight, king: Mob, api: SimApi): void {
  if (b.split) return;
  b.split = true;
  king.data.f1split = 1;
  sim.events.push({
    t: 'boss',
    what: 'split',
    text: 'УЗЕЛ ЛОПНУЛ',
    sub: 'два малых короля отгрызли хвосты',
  });
  sim.hitstop = Math.max(sim.hitstop, 0.12);
  // v2.85 — только рисунок: узел хвостов рвётся — вспышка, клочья, обрубки.
  const kx = king.x - Math.cos(king.face) * 0.7;
  vfx(sim, 'f1_split_hit', kx, king.y + 0.1, 1.8, { vAng: king.face }, true);
  sim.events.push({ t: 'flash', k: 0.35, color: '#ffd0c8' });
  for (let i = 0; i < 2; i++) {
    const a = king.face + Math.PI + (i === 0 ? -0.7 : 0.7);
    const k = api.spawnMob(sim, 'kinglet', king.x + Math.cos(a) * 1.2, king.y + Math.sin(a) * 1.2, {
      mode: 'stun',
      level: king.level,
    });
    k.hp = k.maxHp = king.maxHp * KINGLET_SHARE;
    k.kx = Math.cos(a) * 6;
    k.ky = Math.sin(a) * 6;
    k.summonCd = 99;
    if (b.data.rage) k.dmg *= KING_RAGE_DMG;
    api.collide(sim, k);
  }
}

function kingStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  // Метки королей рисует `f1-boss-fx.ts` сам — красная заливка движка
  // легла бы поверх. v2.85 — только рисунок.
  m.data.vNoTele = 1;
  const h = sim.hero;
  const b = sim.boss!;
  const { dx, dy, dist } = c;
  const small = m.kind === 'kinglet';
  const blade = !small && b.phase >= 3;
  const haste = (b.t > KING_RAGE ? 1.35 : 1) * (blade && m.hp < m.maxHp * 0.1 ? 1.15 : 1);
  m.summonCd -= dt;
  switch (m.mode) {
    case 'roar':
    case 'swap':
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > (m.mode === 'swap' ? 1.5 : 1.2)) api.setMode(m, 'chase');
      return;
    case 'chase': {
      const s = m.speed * haste * (blade ? 1.1 : 1);
      const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
      api.steer(sim, m, cx, cy, s, dt);
      // v2.85 — только рисунок: тяжёлые шаги короля поднимают пыль.
      if (!small && (m.data.vStep = (m.data.vStep ?? 0) + Math.hypot(m.vx, m.vy) * dt) > 1.1) {
        m.data.vStep = 0;
        m.data.vFoot = -(m.data.vFoot ?? 1);
        const fx = m.x - Math.sin(m.face) * 0.28 * m.data.vFoot;
        vfx(sim, 'f1_step', fx, m.y + 0.25 + Math.cos(m.face) * 0.12 * m.data.vFoot, 0.7, {
          vAng: m.face,
        });
      }
      if (m.t > (small ? 0.9 : 1.3) / haste) {
        const r = sim.rng();
        if (!small && b.phase >= 1 && m.summonCd <= 0 && r < 0.25) {
          api.setMode(m, 'summon');
          sim.events.push({ t: 'boss', what: 'summon' });
          // v2.85 — только рисунок: у нор арены вспучивается земля.
          for (const hb of arenaHoles(sim, api)) {
            const [ox, oy] = hb.obj.out ?? [hb.obj.x, hb.obj.y];
            vfx(sim, 'f1_bulge', ox + 0.5, oy + 0.5, 1.9);
          }
        } else if (blade) {
          // Рельс-двуручник: издали — прыжок, вблизи — тройной взмах.
          if (dist > 3.4 || r < 0.3) {
            m.data.lx = h.x;
            m.data.ly = h.y;
            api.setMode(m, 'leapAim');
          } else {
            m.data.combo = 3;
            m.dir = Math.atan2(dy, dx);
            api.setMode(m, 'sweepAim');
          }
        } else if (dist > 3 || r < 0.35) {
          api.setMode(m, 'rollAim');
          m.dir = Math.atan2(dy, dx);
        } else if (!small && r < 0.7) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'cleaveAim');
        } else api.setMode(m, 'whipAim');
      }
      return;
    }
    // --- Тесак и крышка (полосы I–III) ---
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
      // v2.85 — только рисунок: пыль и солома из-под клубка (≤ 10 в секунду).
      if ((m.data.vRoll = (m.data.vRoll ?? 0) + s * dt) > (small ? 2.4 : 1.3)) {
        m.data.vRoll = 0;
        vfx(sim, 'f1_rolldust', m.x, m.y + m.r * 0.5, 0.9, { vAng: m.dir, vR: m.r });
      }
      // Качение бьёт один раз: попал — король и сам оглушён ударом, это
      // окно для ответа.
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
    case 'cleaveAim': {
      // Тесак над головой: конус наливается, в последний миг — уклон.
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t < 0.4) m.dir = Math.atan2(dy, dx);
      m.face = m.dir;
      const wu = 0.75 / haste;
      m.tele = { shape: 'cone', r: 2.4, arc: 2.1, ang: m.dir, k: Math.min(1, m.t / wu) };
      if (m.t > wu - 0.25) m.danger = 3;
      if (m.t >= wu) {
        const off = Math.abs(angDiff(Math.atan2(dy, dx), m.dir));
        if (dist < 2.4 + h.r && off < 1.05 + Math.atan(h.r / Math.max(0.1, dist)))
          api.hurtHero(sim, m.dmg * 1.15, m.x, m.y, 7, m.kind);
        sim.events.push({ t: 'boss', what: 'whip' });
        sim.events.push({
          t: 'boom',
          x: m.x + Math.cos(m.dir) * 1.4,
          y: m.y + Math.sin(m.dir) * 1.4,
          r: 0,
        });
        // v2.85 — только рисунок: тесак в пол — рубец, щепа, пыль, искры.
        vfx(sim, 'f1_cleave_hit', m.x, m.y, 1.7, { vAng: m.dir }, true);
        sim.events.push({ t: 'shake', k: 0.12 });
        api.setMode(m, 'recover');
        m.data.rec = 0.7;
      }
      return;
    }
    case 'whipAim': {
      m.vx *= 0.7;
      m.vy *= 0.7;
      const r = small ? 1.7 : 2.1;
      m.tele = { shape: 'ring', r, k: Math.min(1, (m.t * haste) / 0.7) };
      if (m.t > 0.5) m.danger = 2.6;
      if (m.t > 0.7 / haste) {
        if (dist < r + h.r) api.hurtHero(sim, m.dmg, m.x, m.y, 6, m.kind);
        sim.events.push({ t: 'boss', what: 'whip' });
        sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
        vfx(sim, 'f1_whip_hit', m.x, m.y, 1.3, { vR: r }, true); // v2.85 — только рисунок
        api.setMode(m, 'recover');
        m.data.rec = 0.6;
      }
      return;
    }
    case 'summon':
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t > 1) {
        summonRats(sim, m, api);
        api.setMode(m, 'chase');
      }
      return;
    // --- Рельс-двуручник (полоса IV) ---
    case 'sweepAim': {
      // Три взмаха подряд, каждый со своей меткой; между ними — довод.
      m.vx *= 0.7;
      m.vy *= 0.7;
      const first = (m.data.combo ?? 3) === 3;
      const wu = (first ? 0.55 : 0.38) / haste;
      if (m.t < wu * 0.5) m.dir = Math.atan2(dy, dx);
      m.face = m.dir;
      m.tele = { shape: 'cone', r: 2.8, arc: 2.5, ang: m.dir, k: Math.min(1, m.t / wu) };
      if (m.t > wu - 0.22) m.danger = 3.4;
      if (m.t >= wu) {
        const off = Math.abs(angDiff(Math.atan2(dy, dx), m.dir));
        if (dist < 2.8 + h.r && off < 1.25 + Math.atan(h.r / Math.max(0.1, dist)))
          api.hurtHero(sim, m.dmg, m.x, m.y, 6, m.kind);
        sim.events.push({ t: 'boss', what: 'whip' });
        // Шаг вперёд на взмахе — двуручник тянет за собой.
        m.vx += Math.cos(m.dir) * 5;
        m.vy += Math.sin(m.dir) * 5;
        // v2.85 — только рисунок: борозда и веер искр рельса; третий — тяжелее.
        const vn = 3 - (m.data.combo ?? 3);
        vfx(sim, 'f1_sweep_hit', m.x, m.y, 1.5, { vAng: m.dir, vN: vn }, true);
        sim.events.push({ t: 'shake', k: vn >= 2 ? 0.3 : 0.16 });
        m.data.combo = (m.data.combo ?? 3) - 1;
        m.data.swing = 3 - m.data.combo;
        if (m.data.combo > 0) api.setMode(m, 'sweepAim');
        else {
          api.setMode(m, 'recover');
          m.data.rec = 1.1;
        }
      }
      return;
    }
    case 'leapAim': {
      // Присел: круг падения наливается там, где стоит герой; прицел
      // замирает за полсекунды до прыжка.
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t < 0.4) {
        m.data.lx = h.x;
        m.data.ly = h.y;
      }
      const wu = 0.7 / haste;
      m.face = Math.atan2(m.data.ly - m.y, m.data.lx - m.x);
      m.tele = {
        shape: 'circle',
        r: 1.7,
        k: Math.min(1, m.t / (wu + 0.5)),
        x: m.data.lx,
        y: m.data.ly,
      };
      if (m.t >= wu) {
        m.data.sx = m.x;
        m.data.sy = m.y;
        m.data.ghost = 1;
        api.setMode(m, 'leap');
        // v2.85 — только рисунок: толчок от пола.
        const va = Math.atan2(m.data.ly - m.y, m.data.lx - m.x);
        vfx(sim, 'f1_takeoff', m.x, m.y, 1.0, { vAng: va });
        sim.events.push({ t: 'shake', k: 0.06 });
      }
      return;
    }
    case 'leap': {
      // В воздухе: недосягаем, метка на полу догорает.
      const T = 0.5;
      const k = Math.min(1, m.t / T);
      m.tele = { shape: 'circle', r: 1.7, k: 0.6 + 0.4 * k, x: m.data.lx, y: m.data.ly };
      m.danger = k > 0.5 ? 2.2 : 0;
      const tx = m.data.sx + (m.data.lx - m.data.sx) * k;
      const ty = m.data.sy + (m.data.ly - m.data.sy) * k;
      m.vx = (tx - m.x) / Math.max(dt, 1e-3);
      m.vy = (ty - m.y) / Math.max(dt, 1e-3);
      if (k >= 1) {
        m.vx = 0;
        m.vy = 0;
        m.data.ghost = 0;
        m.tele = null;
        const lx = m.data.lx;
        const ly = m.data.ly;
        if (Math.hypot(h.x - lx, h.y - ly) < 1.7 + h.r)
          api.hurtHero(sim, m.dmg * 1.5, lx, ly, 9, m.kind);
        sim.hitstop = Math.max(sim.hitstop, 0.08);
        sim.events.push({ t: 'boom', x: lx, y: ly, r: 0 });
        sim.events.push({ t: 'boss', what: 'roll' });
        // v2.85 — только рисунок: воронка, глыбы, пыль — самый тяжёлый удар.
        vfx(sim, 'f1_leap_hit', lx, ly, 2.8, {}, true);
        sim.events.push({ t: 'shake', k: 0.3 }, { t: 'flash', k: 0.3, color: '#ffe2b0' });
        // За прыжком — волна кольцом: внутри неё безопасно.
        api.strike(sim, {
          shape: 'ring',
          x: lx,
          y: ly,
          r: 3,
          w: 0.45,
          warn: 0.5,
          dmg: m.dmg * 0.8,
          knock: 6,
          art: 'f1_shock',
          from: m.id,
        });
        api.setMode(m, 'recover');
        m.data.rec = 1.0;
      }
      return;
    }
    case 'recover':
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > (m.data.rec ?? 0.6)) api.setMode(m, 'chase');
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
    if (!sim.boss) {
      // Вне боя (стенд, тест) — просто стоит.
      m.vx *= 0.8;
      m.vy *= 0.8;
      return;
    }
    // Метки ставит сам шаг; прошлые гаснут.
    if (m.mode !== 'leap') m.data.ghost = 0;
    const was = m.mode;
    m.tele = null;
    m.danger = 0;
    kingStep(sim, m, dt, c, api);
    const h = sim.hero;
    const small = m.kind === 'kinglet';
    const haste = sim.boss.t > KING_RAGE ? 1.35 : 1;
    m.bounce = m.mode === 'roll';
    if (m.mode === 'rollAim') {
      m.tele = { shape: 'line', r: 7, w: m.r, ang: m.dir, k: Math.min(1, m.t / 0.8) };
      if (m.t > 0.6) m.danger = 4;
    } else if (m.mode === 'roll') m.danger = m.r + h.r + 1.4;
    else if (m.mode === 'whipAim' && was === 'whipAim') {
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
    // v2.85 — только рисунок: осколки от стены в зал.
    const nl = Math.hypot(nx, ny) || 1;
    const wo = { vNx: nx / nl, vNy: ny / nl };
    vfx(sim, 'f1_wall_hit', m.x - wo.vNx * m.r, m.y - wo.vNy * m.r, 1.5, wo, true);
    sim.events.push({ t: 'shake', k: 0.1 });
    if (m.bounces > 1) api.setMode(m, 'dizzy');
  },
});

registerBoss('king', {
  start(sim, b, lead) {
    lead.summonCd = 8;
    // v2.85 — только рисунок: смотритель меток на весь бой (пол и свет).
    vfx(sim, 'f1_kingtele', lead.x, lead.y, 1e9, {}, true);
    // Малые короли ещё на хвостах: их доля полосы — запас с самого начала.
    b.data.kres = lead.maxHp * KINGLET_SHARE * 2;
    b.phase = 0;
    void sim;
  },
  step(sim, b, _dt, api) {
    // Ярость: все части бьют больнее; объявляется один раз.
    if (b.t > KING_RAGE && !b.data.rage) {
      b.data.rage = 1;
      for (const m of sim.mobs)
        if (m.kind === 'king' || m.kind === 'kinglet') m.dmg *= KING_RAGE_DMG;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'ЯРОСТЬ',
        sub: 'король теряет терпение — бьёт чаще и больнее',
      });
    }
    const king = kingOf(sim);
    if (!king || king.mode === 'swap' || king.mode === 'leap') return;
    const k = king.hp / king.maxHp;
    if (b.phase === 0 && k <= KING_BARS[0]) {
      b.phase = 1;
      api.setMode(king, 'roar');
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'СТРАЖА!',
        sub: 'латники из мусора — щит спереди, бей со спины',
      });
      callGuards(sim, 2, api);
      return;
    }
    if (b.phase === 1 && k <= KING_BARS[1]) {
      b.phase = 2;
      api.setMode(king, 'roar');
      splitKing(sim, b, king, api);
      return;
    }
    if (b.phase === 2 && k <= KING_BARS[2]) {
      b.phase = 3;
      king.data.f1blade = 1;
      api.setMode(king, 'swap');
      king.tele = null;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'СМЕНА ОРУЖИЯ',
        sub: 'рельс-двуручник — тройной взмах и прыжок',
      });
      // Брошенный тесак лежит на полу.
      api.zone(sim, { x: king.x - 0.9, y: king.y + 0.4, r: 0.6, life: 90, art: 'f1_cleaver' });
      vfx(sim, 'f1_cleaverdrop_hit', king.x - 0.9, king.y + 0.4, 1.3, {}, true); // v2.85 — только рисунок
      callGuards(sim, 1, api);
    }
  },
  onPartDown(sim, b, m, api) {
    // Добили раньше, чем лопнул узел (крит в последнюю четверть второй
    // полосы) — малые отрываются всё равно: бой не обрывается на полуслове.
    if (m.kind === 'king' && !b.split) {
      m.mode = 'dying';
      m.t = 0;
      splitKing(sim, b, m, api);
      return true;
    }
    return false;
  },
  bar(sim, b) {
    // Одна полоса на весь бой: король плюс доля малых (до раскола — запас).
    const king = sim.mobs.find((m) => m.kind === 'king' && m.mode !== 'dying');
    const res = b.data.kres ?? 0;
    let hp = king ? Math.max(0, king.hp) : 0;
    let max = king ? king.maxHp : (b.data.kmax ?? 0);
    if (king) b.data.kmax = king.maxHp;
    if (!b.split) hp += res;
    else
      for (const m of sim.mobs)
        if (m.kind === 'kinglet' && m.mode !== 'dying') hp += Math.max(0, m.hp);
    max += res;
    return max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  },
  reset(sim) {
    // Бой сброшен: стража и подмога короля уходят с ним.
    sim.mobs = sim.mobs.filter((m) => !m.data.f1boss);
  },
});
