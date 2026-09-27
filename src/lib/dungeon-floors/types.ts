// Договор этажа подземелья (v2.81). Этаж — это стопка районов со своими
// картами, монстрами, боссом, шахтой и материалами. Движок (`dungeon-sim`,
// `dungeon-render`, `dungeon-world`) читает этаж только через эти типы, а
// этажи НЕ импортируют движок значениями: данные этажа (`fN.ts`) грузятся
// правилами (`dungeon.ts`) при старте, и обратный импорт замкнул бы модули.
// ИИ и рисовальщики этажа — отдельные файлы (`fN-brains.ts`, `fN-art.ts`),
// они регистрируются в реестрах `dungeon-ai.ts` и `dungeon-paint.ts`.
//
// Правила и приёмы — в `scripts/dungeon/README.md` (библия этажей).

import type { MobDef } from '../dungeon';

/** Номера пород подземелья начинаются здесь: одна нумерация с шахтой каторги. */
export const DEEP_BASE = 100;
/** Пустая порода и пирит — общие для всех этажей. */
export const DEEP_WALLROCK = DEEP_BASE;
export const DEEP_PYRITE = DEEP_BASE + 1;

/** Статусы, которые удар или клетка вешает на героя. */
export type StatusKind = 'poison' | 'burn' | 'slow' | 'stun' | 'chill';

/** Опасная клетка: что она делает с тем, кто стоит в ней. */
export interface HazardSpec {
  status?: StatusKind;
  /** Сколько длится статус после того, как вышел, с. */
  dur?: number;
  /** Урон в секунду в доле здоровья героя (0,05 — 5% в секунду). */
  dps?: number;
  /** Множитель скорости, пока стоишь (вода, грязь, паутина). */
  slow?: number;
}

/**
 * Своя буква карты района. Базовая легенда (стены, пол, ящики, норы,
 * лифт, шахта, ворота, босс, лестница…) — в `dungeon-world.ts`; здесь —
 * то, что придумал этаж.
 */
export interface LegendCell {
  /**
   * Клетка: пол, стена, «глубина» (вода, пропасть, лава — не пройти, но
   * это не стена: у неё нет лица, снаряды летят над ней, летуны проходят)
   * или опасный пол (ходить можно, но он жжёт, травит или вязнет).
   */
  tile: 'floor' | 'wall' | 'deep' | 'hazard';
  /**
   * Номер вида 1…255 — рисовальщик клеток района различает по нему свои
   * клетки (грибница, кости, кристаллы). 0 — обычная клетка.
   */
  mark?: number;
  hazard?: HazardSpec;
  /**
   * Предмет на клетке: `deco` — неломаемый (статуя, сталагмит, куст
   * грибов), `breakable` — бьётся, как ящик (свои картинка и добыча).
   * Рисует `registerPropPainter(ref)`.
   */
  obj?: { kind: 'deco' | 'breakable'; ref: string; solid?: number; hp?: number; light?: LightSpec };
  /** Свет от клетки (светящиеся грибы, лава, кристаллы). */
  light?: LightSpec;
}

export interface LightSpec {
  r: number;
  tint: 'warm' | 'cold' | 'teal' | 'red' | 'violet' | 'green';
}

/**
 * Облик района. Плитки — атлас 0x72 (кирпич/плиты или дикая порода/грунт),
 * перекрашенный `tint`; свои клетки (марки из легенды) рисует
 * `registerCellPainter(areaId)`.
 */
export interface AreaSkin {
  floor: 'slab' | 'ground';
  wall: 'brick' | 'rock';
  /**
   * Перекраска всех плиток района: множители каналов RGB и подмешивание
   * цвета. `[1, 1, 1, 0, '#000']` — без изменений.
   */
  tint?: { mul: [number, number, number]; mix?: string; k?: number };
  /** Цвет пустоты за краем света (туман, вода, тьма). */
  fog?: string;
}

/** Кто и как появляется в районе. Функции — чтобы порядок бросков был свой. */
export interface SpawnSpec {
  /** Вес видов для нор, засад и шума шахты. */
  mobs: [string, number][];
  /** Плотность появления из нор, 1 — как во Входе в шахты. */
  density: number;
  /** Сколько в пачке из норы: `base + floor(rnd·spread)`. */
  pack: [number, number];
  /** Кто идёт следом за первым в пачке (у крыс — серая крыса). */
  filler: string;
  /** Спящая стая: вид i-го из n. */
  group?: (i: number, n: number, rnd: () => number) => string;
  /** Поток из норы (как крысиная орда): вид каждого, или null — потока нет. */
  horde?: ((rnd: () => number) => string) | null;
  /** Редкий «золотой» беглец с мешком монет. */
  treasure?: string | null;
  /** Кто лезет из гнезда (`n`, `v`). */
  nest?: (cart: boolean, rnd: () => number) => string;
  /** Сорвавшиеся вагонетки на рельсах. */
  carts?: boolean;
}

export interface AreaSpec {
  id: string;
  name: string;
  /** Подпись под названием при входе. */
  lead: string;
  /** Ступень снаряжения, под которую задуман. */
  tier: number;
  /** Уровень: множит силу монстров (×1,8 здоровья за уровень) и цену мяса. */
  level: number;
  /** Сколько света без ламп и фонаря, 0…1. */
  ambient: number;
  /** Ряды карты, по 64 символа; первый ряд — север. */
  rows: string[];
  skin: AreaSkin;
  spawn: SpawnSpec;
  legend?: Record<string, LegendCell>;
  /** Какая шахта этажа за входом `M` этого района. */
  mine?: string;
}

/**
 * Шахта этажа: поле 7×9×5, как у каторги. Две руды этажа — номера пород
 * шахты каторги (0 — Глина, 1 — Песчаник…), их цельные блоки лежат редкими
 * клетками. Пирит — прожилкой (на нём держится заточка снаряжения).
 */
export interface MineSpec {
  id: string;
  name: string;
  /** Район, где вход. */
  area: string;
  windowMs: number;
  /** Две руды этажа (номера `ROCKS`). */
  ores: [number, number];
  /** Доля руды по ярусам 0…4 (остальное — пустая порода). */
  share: number[];
  /** Доля пирита среди руды, 0 — нет. */
  pyrite: number;
  /** Сколько цельных блоков в среднем на поле. */
  blocks: number;
}

export interface BossLoot {
  tokens: number;
  keys: number;
  coins: number;
  mats: Partial<Record<string, number>>;
}

export interface BossSpec {
  id: string;
  name: string;
  /** Подпись на табло и в лобби. */
  lead: string;
  /** Район с ареной (`K` на карте). */
  area: string;
  /** Отдых после победы, мс. */
  restMs: number;
  /** Кого будит арена. */
  mob: string;
  /** Сценарий боя (`registerBoss`). */
  script: string;
  /** Кто считается частью босса (полоса здоровья и победа). */
  parts: string[];
  /** Сундук босса. */
  loot: (rnd: () => number) => BossLoot;
}

/** Мясо и прочая еда: продаётся на подъёме, лечит. */
export interface MeatDef {
  id: string;
  name: string;
  /** Цена куска во Входе в шахты; глубже — дороже. */
  price: number;
  /** Сколько лечит, доля здоровья. */
  heal: number;
}

export interface MatDefIn {
  id: string;
  name: string;
  price: number;
  lead: string;
  /** Сколько в одной ячейке рюкзака (32 по умолчанию; трофей — 1). */
  stack?: number;
}

export interface FloorDef {
  /** Номер этажа, с 1. */
  id: number;
  name: string;
  /** Подпись в лобби. */
  lead: string;
  /** Районы СНИЗУ ВВЕРХ: первый — вход (лифт этажа), дальше глубже. */
  areas: AreaSpec[];
  boss: BossSpec;
  mines: MineSpec[];
  mobs: MobDef[];
  meats: MeatDef[];
  mats: MatDefIn[];
  /** Музыка: сцены из `lib/audio-manifest.ts`. */
  music: { explore: string; boss: string };
  /** Обложка в лобби — кадр самой игры, `/ui/areas/…`. */
  cover: string;
  /**
   * Версия планировки этажа: поменяли карту — поднимите, и сохранение
   * сбросит разведку, фонари и тайники ЭТОГО этажа.
   */
  mapVer: number;
}
