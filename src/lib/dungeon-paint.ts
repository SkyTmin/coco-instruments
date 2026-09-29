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
  /**
   * Время рендера, с (v2.85). Идёт и во время стоп-кадра, когда `t` стоит:
   * «дыхание», пламя, запаздывающие части. Технику считать от `t`.
   */
  now: number;
}

export interface MobFrame {
  img: HTMLCanvasElement;
  /** Середина тела по x от левого края кадра, пиксели. */
  ax: number;
  /** Земля (ноги) по y от верхнего края кадра, пиксели. */
  ay: number;
  /** Где глаз в кадре (светится в темноте), или null. */
  eye?: [number, number] | null;
  // ---- Движок анимаций (v2.85). Всё необязательно: старые кадры те же. ----
  /** Сдвиг кадра, игровые пиксели, можно дробно: выпад, прыжок, отдача. */
  dx?: number;
  dy?: number;
  /** Сжатие-растяжение от точки ног (1 — как есть). */
  sx?: number;
  sy?: number;
  /** Наклон вокруг точки ног, радианы. */
  rot?: number;
  /** Не трясти на замахе и не качать летуна: подготовку рисует сам кадр. */
  still?: boolean;
  /** Полуось тени, пиксели; 0 — без тени. Иначе тень считается от ширины холста. */
  shadow?: number;
  /**
   * Слой ПОВЕРХ темноты того же размера и с той же привязкой: глаза, руны,
   * раскалённый клинок, свечение пасти. Рисуется после маски света.
   */
  lit?: HTMLCanvasElement | null;
  /** Шлейф силуэтов, как у рывка героя: раз в `every` с, живёт `life` с. */
  ghost?: { every: number; life: number; tint: string; alpha?: number } | null;
  /** Прозрачность кадра 0…1 (сверх появления). */
  alpha?: number;
  /**
   * Смерть длиннее 0,7 с: сколько секунд режима `dying` рисовать. Движок
   * держит копию убранного моба и зовёт рисовальщик дальше с растущим `t`;
   * растворение движка при этом выключено — прозрачность решает `alpha`.
   */
  linger?: number;
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

// ---- Движок анимаций (v2.85) ---------------------------------------------

/** Что приземлилось: удар по площади (форма из `StrikeIn`) или снаряд. */
export interface ImpactRec {
  art: string;
  x: number;
  y: number;
  shape?: 'circle' | 'line' | 'cone' | 'ring';
  r?: number;
  w?: number;
  ang?: number;
  arc?: number;
  /** Скорость снаряда в миг удара (клеток/с). */
  vx?: number;
  vy?: number;
  /** Случайное зерно записи — чтобы осколки двух ударов не совпадали. */
  seed: number;
}

/**
 * Контакт удара: рисует на полу в точке (px, py) — центр удара, `age` —
 * секунды после приземления (идёт по времени рендера, и в стоп-кадре тоже).
 * Вернуть false — запись кончилась раньше `life`.
 */
export type ImpactPainter = (
  g: CanvasRenderingContext2D,
  rec: ImpactRec,
  px: number,
  py: number,
  scale: number,
  age: number,
  time: number,
) => boolean;

export interface ImpactDef {
  paint: ImpactPainter;
  /** Сколько живёт запись, с. */
  life: number;
  /** Тряска кадра 0…1, если герой ближе 7 клеток (вместо общей 0,12). */
  shake?: number;
  /** Вспышка экрана 0…1 и её цвет `'r,g,b'`. */
  flash?: number;
  flashRgb?: string;
  /** Рисовать поверх темноты (после маски света). */
  above?: boolean;
  /** Оставить и общий взрыв движка (8 частиц и кольцо). */
  keepBurst?: boolean;
}

export const IMPACT_PAINTERS = new Map<string, ImpactDef>();
/** Контакт удара `art` (удар по площади или снаряд) — вместо общего взрыва. */
export const registerImpactPainter = (art: string, def: ImpactDef) =>
  void IMPACT_PAINTERS.set(art, def);

/**
 * Прогрев кадров: генератор рисует кадры рисовальщика `paintId` по одному
 * на шаг (`yield` после каждого). Рендер тратит на него до 3 мс за кадр,
 * пока такой моб есть в мире, — техника не рисуется впервые прямо в бою.
 */
export const MOB_WARM = new Map<string, () => Iterator<unknown>>();
export const registerMobWarm = (paintId: string, gen: () => Iterator<unknown>) =>
  void MOB_WARM.set(paintId, gen);

/**
 * Кеш кадров с вытеснением давно не нужных. У этажей кеши — простые `Map`
 * без предела; для босса на 24 к/с это сотни холстов, поэтому — сюда.
 */
export interface FrameLRU<V> {
  get(key: string): V | undefined;
  set(key: string, v: V): V;
  readonly size: number;
  clear(): void;
}

export function frameLRU<V>(limit: number): FrameLRU<V> {
  const m = new Map<string, V>();
  return {
    get(key) {
      const v = m.get(key);
      if (v !== undefined) {
        m.delete(key);
        m.set(key, v);
      }
      return v;
    },
    set(key, v) {
      m.delete(key);
      m.set(key, v);
      while (m.size > limit) m.delete(m.keys().next().value as string);
      return v;
    },
    get size() {
      return m.size;
    },
    clear() {
      m.clear();
    },
  };
}
