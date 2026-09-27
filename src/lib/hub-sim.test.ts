import { describe, expect, it } from 'vitest';
import { HUB_MAPS } from './hub-maps';
import {
  canStand,
  createHubSim,
  doorGoals,
  enterMap,
  findPath,
  HUB_NO_INPUT,
  hitTest,
  loadMap,
  nearestStand,
  nearestUsable,
  placeAtDoor,
  spawnOf,
  nodeAt,
  standNode,
  stepHub,
  talkGoals,
  TALK_R,
  walkTo,
} from './hub-sim';
import type { HubDoor, HubEvent, HubSim } from './hub-sim';

const IDS = Object.keys(HUB_MAPS);
const DT = 1 / 60;

/** Шагать, пока не случится событие `want`; не дольше `secs`. */
function until(sim: HubSim, want: (e: HubEvent) => boolean, secs = 30, input = HUB_NO_INPUT) {
  for (let t = 0; t < secs; t += DT) {
    stepHub(sim, DT, input);
    const hit = sim.events.find(want);
    sim.events.length = 0;
    if (hit) return hit;
  }
  return null;
}

/** Карта-стенд: четыре на три плитки, поперёк стена со щелью в три четверти плитки. */
function gapMap(): string {
  const id = '__gap';
  if (HUB_MAPS[id]) return id;
  const cw = 16;
  const ch = 12;
  const bits = new Uint8Array(Math.ceil((cw * ch) / 8));
  for (let j = 4; j < 8; j++)
    for (let i = 0; i < cw; i++) {
      if (i >= 6 && i <= 8) continue;
      const k = j * cw + i;
      bits[k >> 3] |= 0x80 >> (k & 7);
    }
  HUB_MAPS[id] = {
    id, name: '', kind: 'indoor', w: 4, h: 3, ambient: 1, music: '', bg: '#000', sub: 4,
    solid: btoa(String.fromCharCode(...bits)),
    objs: [], npcs: [], doors: [], lights: [], fx: [], spawns: { in: [1.875, 0.5, 0] }, marks: {}, searchlights: [],
  };
  return id;
}

describe('площадь: узкие места (v2.80.1)', () => {
  // Владелец: «визуально видно, что можешь пройти, но не получается», особенно у
  // входов. Щель в три четверти плитки телу 0,3 впору — её обязаны проходить и
  // джойстик, и путь по тапу.
  it('щель в три четверти плитки проходима джойстиком', () => {
    const sim = createHubSim({ map: gapMap(), at: 'in' });
    for (let t = 0; t < 3; t += DT) stepHub(sim, DT, { mx: 0, my: 1 });
    expect(sim.hero.y).toBeGreaterThan(2.2);
  });

  it('и путём по тапу', () => {
    const m = loadMap(gapMap());
    const g = nearestStand(m, 1.875, 2.5, 0.5);
    expect(g).not.toBeNull();
    const path = findPath(m, 1.875, 0.5, [{ i: g!.i, j: g!.j, extra: 0 }]);
    expect(path).not.toBeNull();
  });

  it('у башни Чародея ходят по траве у её боков', () => {
    // Участок башни 5×5, а сама она — цилиндр: бока участка были невидимой стеной.
    const m = loadMap('square');
    expect(canStand(m, 53.4, 21.5)).toBe(true);
    expect(canStand(m, 57.6, 21.5)).toBe(true);
  });
});

describe('площадь: карты', () => {
  it('ни одна точка появления не стоит в стене', () => {
    for (const id of IDS) {
      const m = loadMap(id);
      for (const [name, s] of Object.entries(m.data.spawns))
        expect(canStand(m, s[0], s[1]), `${id}:${name}`).toBe(true);
    }
  });

  it('у каждой двери есть где встать в её зоне и перед ней', () => {
    for (const id of IDS) {
      const m = loadMap(id);
      for (const d of m.doors) {
        let inZone = false;
        const S = m.sub;
        for (let j = Math.floor(d.zone.y0 * S) - 1; j <= Math.ceil(d.zone.y1 * S); j++)
          for (let i = Math.floor(d.zone.x0 * S) - 1; i <= Math.ceil(d.zone.x1 * S); i++) {
            const x = nodeAt(m, i);
            const y = nodeAt(m, j);
            if (x < d.zone.x0 || x > d.zone.x1 || y < d.zone.y0 || y > d.zone.y1) continue;
            if (standNode(m, i, j)) inZone = true;
          }
        expect(inZone, `${id}: дверь в ${d.to}`).toBe(true);
        expect(canStand(m, d.ax, d.ay), `${id}: перед дверью в ${d.to}`).toBe(true);
        // Точка перед дверью — снаружи её зоны: вернувшийся туда не уходит
        // сразу обратно, а шагнувший в дверь — уходит.
        const z = d.zone;
        const out = d.ax < z.x0 || d.ax > z.x1 || d.ay < z.y0 || d.ay > z.y1;
        expect(out, `${id}: точка перед дверью в ${d.to} вне зоны`).toBe(true);
      }
    }
  });

  it('из каждой точки появления дойти до каждой двери и каждого жителя', () => {
    for (const id of IDS) {
      const m = loadMap(id);
      for (const [name, s] of Object.entries(m.data.spawns)) {
        for (const d of m.doors)
          expect(
            findPath(m, s[0], s[1], doorGoals(m, d)),
            `${id}:${name} → дверь в ${d.to}`,
          ).not.toBeNull();
        for (const n of m.data.npcs)
          expect(
            findPath(m, s[0], s[1], talkGoals(m, n)),
            `${id}:${name} → ${n.id}`,
          ).not.toBeNull();
      }
    }
  });
});

describe('площадь: ходьба', () => {
  it('появился у двери — стоишь, дверь сама не срабатывает', () => {
    for (const id of IDS) {
      const m = loadMap(id);
      for (const name of Object.keys(m.data.spawns)) {
        const sim = createHubSim({ map: id, at: name });
        expect(
          until(sim, (e) => e.t === 'door', 2),
          `${id}:${name}`,
        ).toBeNull();
      }
    }
  });

  it('вошёл в дверь и вышел обратно — стоишь у той же двери', () => {
    for (const id of IDS) {
      const m = loadMap(id);
      for (const d of m.doors) {
        if (d.action || !HUB_MAPS[d.to]) continue;
        const sim = createHubSim({ map: id, at: Object.keys(m.data.spawns)[0] });
        expect(walkTo(sim, { kind: 'door', i: d.i }), `${id} → ${d.to}`).toBe(true);
        const e = until(sim, (x) => x.t === 'door') as { t: 'door'; door: HubDoor } | null;
        expect(e?.door.i, `${id}: дошёл до двери в ${d.to}`).toBe(d.i);
        // Двери обратно может ещё не быть: площадь рисуют отдельно от
        // комнат, и пока она заглушка, у неё есть не все фасады.
        const back0 = loadMap(d.to).doors.find((x) => x.to === id);
        if (!back0) continue;
        enterMap(sim, d.to, d.at);
        const back = sim.map.doors.find((x) => x.to === id);
        expect(back, `${d.to}: нет двери обратно в ${id}`).toBeTruthy();
        expect(walkTo(sim, { kind: 'door', i: back!.i })).toBe(true);
        const e2 = until(sim, (x) => x.t === 'door') as { t: 'door'; door: HubDoor } | null;
        expect(e2?.door.i, `${d.to}: вышел`).toBe(back!.i);
        enterMap(sim, back!.to, back!.at);
        expect(sim.map.id).toBe(id);
        const dist = Math.hypot(sim.hero.x - d.ax, sim.hero.y - d.ay);
        expect(dist, `${id}: вернулся к двери в ${d.to}`).toBeLessThan(2);
      }
    }
  });

  it('джойстиком в дверь-коврик — дверь срабатывает', () => {
    for (const id of IDS) {
      const m = loadMap(id);
      for (const d of m.doors) {
        if (d.kind === 'use') continue;
        const sim = createHubSim({ map: id, x: d.ax, y: d.ay, face: 0 });
        const e = until(sim, (x) => x.t === 'door', 3, { mx: d.nx, my: d.ny });
        expect(e, `${id}: в дверь ${d.to}`).not.toBeNull();
      }
    }
  });

  it('вернулся из шахты — стоишь перед той дверью, спиной к ней, и она не срабатывает сама', () => {
    for (const id of IDS) {
      const m = loadMap(id);
      for (const d of m.doors) {
        const place = placeAtDoor(m, d);
        const sim = createHubSim(place);
        expect(sim.hero.x).toBeCloseTo(d.ax, 6);
        expect(sim.hero.y).toBeCloseTo(d.ay, 6);
        // Лицом от двери: вектор взгляда против направления «в дверь».
        const look = [
          [0, 1],
          [0, -1],
          [-1, 0],
          [1, 0],
        ][sim.hero.face];
        expect(look[0] * d.nx + look[1] * d.ny, `${id}: ${d.to}`).toBeLessThan(0);
        expect(
          until(sim, (x) => x.t === 'door', 1.5),
          `${id}: ${d.to}`,
        ).toBeNull();
      }
    }
  });

  it('тап по жителю — герой подходит и заговаривает, лицом к нему', () => {
    for (const id of IDS) {
      const m = loadMap(id);
      for (const n of m.data.npcs) {
        for (const name of Object.keys(m.data.spawns)) {
          const sim = createHubSim({ map: id, at: name });
          const t = hitTest(sim, n.x, n.y - 0.5);
          expect(t).toEqual({ kind: 'npc', id: n.id });
          expect(walkTo(sim, t)).toBe(true);
          const e = until(sim, (x) => x.t === 'talk');
          expect(e, `${id}:${name} → ${n.id}`).toEqual({ t: 'talk', npc: n.id });
          expect(Math.hypot(sim.hero.x - n.x, sim.hero.y - n.y)).toBeLessThanOrEqual(TALK_R + 0.05);
          expect(sim.talking).toBe(n.id);
          expect(nearestUsable(sim)).toMatchObject({ kind: 'npc', id: n.id });
        }
      }
    }
  });

  it('тап в пол — герой идёт туда и встаёт, не проваливаясь в стены', () => {
    for (const id of IDS) {
      const m = loadMap(id);
      const s = spawnOf(m, Object.keys(m.data.spawns)[0]);
      const sim = createHubSim(s);
      let reached = 0;
      for (let k = 0; k < 20; k++) {
        const x = 1 + ((k * 7.3) % (m.w - 2));
        const y = 1 + ((k * 5.1) % (m.h - 2));
        if (!walkTo(sim, { kind: 'point', x, y })) continue;
        for (let t = 0; t < 12 && sim.path; t += DT) {
          stepHub(sim, DT, HUB_NO_INPUT);
          sim.events.length = 0;
          expect(canStand(m, sim.hero.x, sim.hero.y, sim.hero.r - 0.01)).toBe(true);
        }
        if (Math.hypot(sim.hero.x - x, sim.hero.y - y) < 1.6) reached++;
        // Дверь могла увести — возвращаем на исходную карту.
        if (sim.map.id !== id) enterMap(sim, id, s);
      }
      expect(reached, id).toBeGreaterThan(0);
    }
  });
});
