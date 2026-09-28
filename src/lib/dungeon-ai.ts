// Реестры ИИ монстров и сценариев боссов (v2.81). Движок (`dungeon-sim`)
// ведёт общие режимы — появление из норы, падение со свода, сон, оглушение,
// привязь, смерть — а всё остальное отдаёт ИИ вида (`MobDef.brain`). Бой с
// боссом — сценарий этажа (`BossSpec.script`).
//
// ИИ и сценарии получают `api` — функции движка. Импортировать движок
// значениями им не нужно (и нельзя: он сам подключает их при загрузке).

import type { MobDef, ShotSpec, StatusKind } from './dungeon';
import type { BossFight, Burrow, Mob, Sim } from './dungeon-sim';
import type { HazardSpec } from './dungeon-floors/types';
import type { Light, WorldObj } from './dungeon-world';

/** Предупреждение на полу: куда придётся удар. Рисует движок. */
export interface Tele {
  shape: 'circle' | 'line' | 'cone' | 'ring';
  /** Круг и кольцо — радиус; линия — длина; конус — радиус. */
  r: number;
  /** Линия — полуширина; кольцо — толщина. */
  w?: number;
  /** Направление линии и конуса. */
  ang?: number;
  /** Конус — раствор, рад. */
  arc?: number;
  /** Насколько налился, 0…1. */
  k: number;
  /** Точка, если не у моба. */
  x?: number;
  y?: number;
}

/** Удар по площади с предупреждением: сперва метка на полу, потом урон. */
export interface StrikeIn {
  shape: 'circle' | 'line' | 'cone' | 'ring';
  x: number;
  y: number;
  r: number;
  w?: number;
  ang?: number;
  arc?: number;
  /** Сколько горит метка до удара, с. */
  warn: number;
  /** Урон по герою (броня режет, как обычно). */
  dmg: number;
  knock?: number;
  status?: StatusKind;
  dur?: number;
  /** Вид для рисовальщика (`registerZonePainter`) и звука. */
  art?: string;
  /** Чей удар: умер моб — метка гаснет. */
  from?: number;
  /**
   * Стены режут удар (Движок 3): героя за стеной от точки удара не задевает.
   * Для ширм, колонн-укрытий, «спрячься за камнем».
   */
  los?: boolean;
  /**
   * Урон по мобам в зоне удара (Движок 3): поезд, пушка, обвал бьют и своих.
   * Боссов не трогает. `Infinity` — насмерть.
   */
  mobDmg?: number;
  /** Рисовать поверх темноты (молния, лазер) — Движок 3. */
  above?: boolean;
}

/** Лужа, облако, огонь: лежит и действует на того, кто стоит внутри. */
export interface ZoneIn {
  x: number;
  y: number;
  r: number;
  /** Сколько живёт, с. */
  life: number;
  /** Урон в секунду — доля здоровья героя. */
  dps?: number;
  status?: StatusKind;
  dur?: number;
  /** Множитель скорости внутри (0,5 — вдвое медленнее). */
  slow?: number;
  /** Сперва видно, потом действует, с. */
  warn?: number;
  art?: string;
  /** Рисовать поверх темноты (свечение, пламя) — Движок 3. */
  above?: boolean;
}

/** Как тянуть героя (`api.pullHero`). */
export interface PullOpts {
  /** Клеток в секунду (по умолчанию 12). */
  speed?: number;
  /** Неуязвим, пока летит (крюк, зип-линия). */
  inv?: boolean;
  /** Сколько тянуть самое большее, с (по умолчанию 2). */
  max?: number;
}

export interface SpawnOpts {
  mode?: string;
  elite?: boolean;
  burrow?: number;
  nest?: number;
  rush?: boolean;
  level?: number;
}

/** Функции движка для ИИ и сценариев. */
export interface SimApi {
  setMode(m: Mob, mode: string): void;
  /** Разогнать к скорости по направлению — плавно. */
  steer(sim: Sim, m: Mob, dx: number, dy: number, speed: number, dt: number): void;
  /** Куда идти к точке: напрямую, если видно, иначе по полю расстояний. */
  chaseDir(sim: Sim, m: Mob, tx: number, ty: number): [number, number];
  /** Направление по полю расстояний до героя (`away` — прочь). */
  flowDir(sim: Sim, x: number, y: number, away?: boolean): [number, number] | null;
  lineOfSight(sim: Sim, ax: number, ay: number, bx: number, by: number): boolean;
  solidTile(sim: Sim, x: number, y: number): boolean;
  /** Ударить героя: броня, неуязвимость, отброс, статус. */
  hurtHero(
    sim: Sim,
    raw: number,
    fx: number,
    fy: number,
    knock: number,
    kind?: string,
    status?: { kind: StatusKind; dur: number },
  ): void;
  /** Повесить статус на героя (яд, ожог, замедление, оглушение, холод). */
  heroStatus(sim: Sim, kind: StatusKind, dur: number, power?: number): void;
  spawnMob(sim: Sim, kind: string, x: number, y: number, opts?: SpawnOpts): Mob;
  fromBurrow(sim: Sim, b: Burrow, kind: string, opts?: { elite?: boolean; rush?: boolean }): Mob;
  dropAt(sim: Sim, kind: string, n: number, x: number, y: number): void;
  explode(sim: Sim, x: number, y: number, r: number, dmg: number, heroShare: number): void;
  /** Выстрел моба по направлению (спецификация — `MobDef.shot`, если не дана). */
  shoot(sim: Sim, m: Mob, ang: number, spec?: ShotSpec, tx?: number, ty?: number): void;
  strike(sim: Sim, s: StrikeIn): void;
  zone(sim: Sim, z: ZoneIn): void;
  inArena(sim: Sim, x: number, y: number): boolean;
  /** Вытолкнуть из стен (круг против клеток). */
  collide(sim: Sim, e: { x: number; y: number; r: number }): boolean;
  /** Кто водится в районе — вид по весам. */
  pickKind(sim: Sim, area: string): string;
  /** Нора рядом с героем для подмоги: мин/макс расстояние. */
  pickBurrow(sim: Sim, minD: number, maxD: number): Burrow | null;
  /** Описание вида. */
  def(kind: string): MobDef;
  /**
   * Сменить клетку на ходу (комнаты, которые двигаются, мост, осыпь):
   * рисунок куска карты и соседей перерисуется сам, поле путей — на
   * ближайшем пересчёте. `mark` — свой вид клетки этажа (0 — обычная).
   */
  setTile(
    sim: Sim,
    x: number,
    y: number,
    tile: number,
    mark?: number,
    haz?: HazardSpec | null,
  ): void;
  /**
   * Свет на ходу (Движок 3): поставить, сдвинуть (тот же `key`) или погасить
   * (`null`). Жаровни, фары поезда, светящиеся вены, огонь в руке.
   */
  light(sim: Sim, key: string, l: Light | null): void;
  /**
   * Урон от окружения (Движок 3): доля здоровья героя, без брони и отброса;
   * неуязвимость и бессмертие креатива уважает. ЗДОРОВЬЕ ГЕРОЯ НАПРЯМУЮ НЕ
   * ТРОГАТЬ — только так или `hurtHero`.
   */
  hurtEnv(sim: Sim, frac: number, status?: { kind: StatusKind; dur: number }): void;
  /** Моб сорвался в пропасть (Движок 3): убийство, добыча — на ближнем краю. */
  fall(sim: Sim, m: Mob): void;
  /**
   * Тянуть героя к точке (Движок 3): крюк, аркан, течение, зип-линия. Ввод
   * заперт, стены останавливают; конец — у точки, об стену или по `max`.
   */
  pullHero(sim: Sim, tx: number, ty: number, o?: PullOpts): void;
  /**
   * Время (Движок 3): мир (мобы, снаряды, удары, зоны, сценарии) идёт с
   * `dt·world`, герой — с `dt·hero`, `dur` секунд настоящего времени.
   * «Мир стоит» — `world: 0`; «герой застыл, а босс ходит» — `hero: 0`.
   */
  timeScale(sim: Sim, world: number, hero: number, dur: number): void;
  /** Камера уходит к точке и через `dur` с возвращается к герою (Движок 3). */
  camera(sim: Sim, x: number, y: number, dur: number): void;
  /** Замедление всего (Движок 3): `scale` 0,2…1 на `dur` с. */
  slowmo(sim: Sim, dur: number, scale: number): void;
  /**
   * Перенести героя (телепорт, ловушка-провал, зеркало): скорость и рывок
   * гаснут, камера прыгает сразу, а не едет через полкарты. Клетка должна
   * быть проходимой — иначе героя вытолкнет к ближайшей.
   */
  moveHero(sim: Sim, x: number, y: number): void;
}

export interface HeroHit {
  /** Урон, который удар нанесёт без множителя. */
  dmg: number;
  crit: boolean;
  heavy: boolean;
  /** Угол от героя к мобу. */
  ang: number;
}

export interface BrainCtx {
  dx: number;
  dy: number;
  /** До героя, клеток. */
  dist: number;
  def: MobDef;
  /** Запах мяса в рюкзаке, 0…1. */
  smell: number;
}

export interface Brain {
  /**
   * Шаг боя. Общие режимы (появление, сон, тревога, оглушение, смерть,
   * привязь) движок уже отработал; сюда приходят остальные.
   */
  step(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void;
  /** Моб ударился о стену на ходу (катящийся отскакивает). */
  onWall?(sim: Sim, m: Mob, nx: number, ny: number, api: SimApi): void;
  /** Моб убит: что бросить, кого позвать. `mode` — режим до смерти. */
  onDeath?(sim: Sim, m: Mob, mode: string, api: SimApi): void;
  /**
   * Героя клинок задел моба — ДО урона. Вернуть множитель урона: 1 —
   * как есть, 0,2 — щит, 0 — отбил (звон, искры, без урона и без
   * отброса), 2 — уязвим. `ang` — откуда пришёл удар (от героя к мобу):
   * щит спереди — сравнить с тем, куда моб смотрит. Не вернуть ничего —
   * как 1.
   */
  onHit?(sim: Sim, m: Mob, hit: HeroHit, api: SimApi): number | void;
  /**
   * ИИ ведёт ВСЕ режимы сам (боссы): движок не трогает сон, привязь,
   * оглушение.
   */
  raw?: boolean;
}

export interface BossScript {
  /** Бой начался: босс уже на арене (`lead`). */
  start?(sim: Sim, b: BossFight, lead: Mob, api: SimApi): void;
  /** Каждый шаг боя. */
  step?(sim: Sim, b: BossFight, dt: number, api: SimApi): void;
  /**
   * Пала часть босса. Вернуть true — бой продолжается (например, король
   * распался на трёх малых), иначе движок проверит, остался ли кто.
   */
  onPartDown?(sim: Sim, b: BossFight, m: Mob, api: SimApi): boolean;
  /** Полоса здоровья 0…1; по умолчанию — сумма частей. */
  bar?(sim: Sim, b: BossFight): number | null;
  /**
   * Засечки фаз на полосе (доли 0…1, как у босса SAO): где сменится
   * поведение. Без них — полоса без засечек.
   */
  notches?(sim: Sim, b: BossFight): number[];
  /** Герой пал — бой сброшен (Движок 3: с `api`, чтобы вернуть арену). */
  reset?(sim: Sim, b: BossFight, api: SimApi): void;
}

/**
 * Правила этажа целиком: то, что не принадлежит ни одному монстру
 * (проклятие подъёма, прилив, гаснущий свет, «статуи смотрят»). `start` —
 * мир собран, `step` — каждый шаг. Черновик — `sim.floorData`.
 */
export interface FloorScript {
  start?(sim: Sim, api: SimApi): void;
  step?(sim: Sim, dt: number, api: SimApi): void;
  /**
   * Нажали «Действие» у предмета этажа с `use` (Движок 3). Вернуть false —
   * «сейчас нельзя» (кнопка просто ничего не сделает).
   */
  onUse?(sim: Sim, obj: WorldObj, api: SimApi): boolean | void;
  /**
   * Подпись кнопки у предмета этажа прямо сейчас (Движок 3): строка —
   * своя подпись («Выстрел», «Зарядка…»), null — кнопки нет (рычаг уже
   * повёрнут). Не задано — всегда `obj.use.label`.
   */
  useLabel?(sim: Sim, obj: WorldObj): string | null;
}

export const BRAINS = new Map<string, Brain>();
export const FLOOR_SCRIPTS = new Map<number, FloorScript>();

export function registerFloor(floor: number, s: FloorScript): void {
  FLOOR_SCRIPTS.set(floor, s);
}
export const BOSS_SCRIPTS = new Map<string, BossScript>();

export function registerBrain(id: string, b: Brain): void {
  BRAINS.set(id, b);
}

export function registerBoss(id: string, s: BossScript): void {
  BOSS_SCRIPTS.set(id, s);
}
