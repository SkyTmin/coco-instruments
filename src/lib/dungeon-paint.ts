// Реестры рисовальщиков подземелья (v2.81). Рендер (`dungeon-render.ts`)
// рисует всё общее сам, а то, что придумал этаж, спрашивает здесь:
//   • монстров с `art: { kind: 'paint', id }` — `registerMobPainter(id)`;
//   • снаряды, удары по площади и лужи — по `art` (`registerShotPainter`,
//     `registerZonePainter`); без рисовальщика — светящийся шар и круг;
//   • предметы этажа (`deco`, `breakable` из легенды) — `registerPropPainter(ref)`;
//   • свои клетки района (марки легенды) — `registerCellPainter(areaId)`;
//   • иконки вещей (материалы этажа) — `registerItemArt(id)`.
// Рисовальщик получает всё, что нужно, параметрами; возвращает `Px` или
// холст. Кешировать кадры — его забота (см. `dungeon-rats.ts`: кадр
// рисуется один раз на позу и сторону).

import type { Px } from './dungeon-art';
import type { Mob, Shot, Sim, Strike, Zone } from './dungeon-sim';
import type { WorldObj } from './dungeon-world';

/** Поза моба для кадра. Движок выводит её из режима ИИ. */
export type MobAnim = 'idle' | 'run' | 'wind' | 'bite' | 'hurt' | 'dead' | 'sleep';

export interface MobPose {
  anim: MobAnim;
  /** Номер кадра — растёт со временем; брать по модулю числа кадров. */
  frame: number;
  /** Режим ИИ как есть — для своих поз (`roll`, `cast`, `charge`…). */
  mode: string;
  /** Время внутри режима, с. */
  t: number;
  /** Смотрит влево. */
  left: boolean;
  /** Вспышка удара — нарисовать белым. */
  flash: boolean;
  /** Элита / альбинос. */
  look: 'normal' | 'elite' | 'albino';
}

export interface MobFrame {
  img: HTMLCanvasElement;
  /** Середина тела по x от левого края кадра, пиксели. */
  ax: number;
  /** Земля (ноги) по y от верхнего края кадра, пиксели. */
  ay: number;
  /** Где глаз в кадре (светится в темноте), или null. */
  eye?: [number, number] | null;
}

export type MobPainter = (m: Mob, pose: MobPose) => MobFrame | null;

export interface Sprite {
  img: HTMLCanvasElement;
  /** Точка привязки (середина основания) от левого верхнего угла, пиксели. */
  ax: number;
  ay: number;
}

export type ShotPainter = (s: Shot, time: number) => Sprite | null;
/** Лужа и удар по площади: рисует на полу контекстом в точке (px, py) — центр. */
export type ZonePainter = (
  g: CanvasRenderingContext2D,
  z: Zone | Strike,
  px: number,
  py: number,
  scale: number,
  time: number,
) => boolean;
export type PropPainter = (
  o: WorldObj,
  time: number,
  alive: boolean,
  flash: boolean,
) => Sprite | null;

/** Своя клетка района: `mark` — вид из легенды, соседи — для стыков. */
export interface CellCtx {
  tile: number;
  mark: number;
  wx: number;
  wy: number;
  /** Проходимо ли (dx, dy). */
  open: (dx: number, dy: number) => boolean;
  /** Вид соседней клетки. */
  markAt: (dx: number, dy: number) => number;
}
/** Нарисовать клетку 16×16. null — пусть рисует общий путь. */
export type CellPainter = (c: CellCtx) => Px | null;

export type ItemPainter = () => Px;

export const MOB_PAINTERS = new Map<string, MobPainter>();
export const SHOT_PAINTERS = new Map<string, ShotPainter>();
export const ZONE_PAINTERS = new Map<string, ZonePainter>();
export const PROP_PAINTERS = new Map<string, PropPainter>();
export const CELL_PAINTERS = new Map<string, CellPainter>();
export const ITEM_ART = new Map<string, ItemPainter>();

export const registerMobPainter = (id: string, f: MobPainter) => void MOB_PAINTERS.set(id, f);
export const registerShotPainter = (art: string, f: ShotPainter) => void SHOT_PAINTERS.set(art, f);
export const registerZonePainter = (art: string, f: ZonePainter) => void ZONE_PAINTERS.set(art, f);
export const registerPropPainter = (ref: string, f: PropPainter) => void PROP_PAINTERS.set(ref, f);
export const registerCellPainter = (area: string, f: CellPainter) =>
  void CELL_PAINTERS.set(area, f);

let painting: Sim | null = null;

/**
 * Вылазка, которую рисуют прямо сейчас (Движок 3): снаряжение героя, где он,
 * фаза босса, `sim.floorData`. Рендер ставит её в начале каждого кадра;
 * вне кадра (иконки, лобби) — null. Кеш кадров по этим данным — забота
 * рисовальщика: ключ кеша обязан покрывать всё, что читается отсюда.
 */
export const paintSim = (): Sim | null => painting;
export const setPaintSim = (s: Sim | null): void => {
  painting = s;
};
export const registerItemArt = (id: string, f: ItemPainter) => void ITEM_ART.set(id, f);
