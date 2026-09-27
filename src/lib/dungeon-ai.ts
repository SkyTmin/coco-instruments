// Реестры ИИ монстров и сценариев боссов (v2.81). Движок (`dungeon-sim`)
// ведёт общие режимы — появление из норы, падение со свода, сон, оглушение,
// привязь, смерть — а всё остальное отдаёт ИИ вида (`MobDef.brain`). Бой с
// боссом — сценарий этажа (`BossSpec.script`).
//
// ИИ и сценарии получают `api` — функции движка. Импортировать движок
// значениями им не нужно (и нельзя: он сам подключает их при загрузке).

import type { MobDef, ShotSpec, StatusKind } from './dungeon';
import type { BossFight, Burrow, Mob, Sim } from './dungeon-sim';

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
  /** Герой пал — бой сброшен. */
  reset?(sim: Sim, b: BossFight): void;
}

export const BRAINS = new Map<string, Brain>();
export const BOSS_SCRIPTS = new Map<string, BossScript>();

export function registerBrain(id: string, b: Brain): void {
  BRAINS.set(id, b);
}

export function registerBoss(id: string, s: BossScript): void {
  BOSS_SCRIPTS.set(id, s);
}
