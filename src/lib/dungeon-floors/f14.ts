// Этаж 14 — «Часовая башня». Витрина третьего захода: механизм огромных
// башенных часов. Латунь, шестерни, маятники, гири на цепях, песочные часы
// и циферблат под крышей. Названия свои.
//
// Глагол этажа — ВРЕМЯ. Он меняет, КАК ты ходишь и дерёшься:
//   • колокол «ЧАС» раз в минуту останавливает мир на две секунды — ходишь
//     только ты: маятники замирают, ножи висят, стены шестерён стоят;
//   • маятники режут проходы по такту, кольца зубьев вращаются навстречу;
//   • сферы замедления и ускорения — внутри время течёт иначе для всех:
//     для монстров, их снарядов и для тебя;
//   • отмотчики, получив удар, возвращаются в прошлое вместе со здоровьем
//     (след показывает, куда), двойник бьёт туда, где ты был пять секунд
//     назад;
//   • наверху время против тебя останавливает сам Повелитель часа.
// Растёт по районам: «Механизм» учит такту (маятники, шестерни, завод,
// колокол), «Песочные часы» — местному времени (сферы, отмотка, песок
// вверх), «Циферблат» — остановленному (Стоп-кадр, стрелки «Полдня»,
// двойники), арена — всему сразу.
//
// Районы (снизу вверх):
//   • «Механизм» (`f14`, вход) — зал лифта с часами, Галерея маятников
//     или Шахта гирь (развилка), Завод (зал-событие: ключ заводит строй
//     солдатиков, стопор держит), Регуляторная, служебный ход с решёткой,
//     Зал шестерён (зал-событие: кольца зубьев вращаются), тайник
//     часовщика за трещиной;
//   • «Песочные часы» (`f14sand`) — нижняя колба (шахта), горловина со
//     струёй, верхняя колба (зал-событие «Перевёрнутые часы»: песок
//     поднимается), Стеклянная галерея (развилка), Зал отмотки
//     (зал-событие: павшие встают, пока целы якоря), решётка, ниша;
//   • «Циферблат» (`f14dial`) — Стоп-кадр (зал-событие: битва замерла,
//     ножи висят), площадь «Полдень» (зал-событие: стрелки метут пол) или
//     Колокольня (развилка, колокол), Преддверие, решётка, арена, печать и
//     лестница.
//
// Монстры (ИИ — `f14-brains.ts`, рисунок — `f14-art.ts`):
//   • заводной солдатик — строем, штык по линии; ключ в спине крутится и
//     кончается: заводу конец — стоит открытый; удар по ключу сзади —
//     сразу стоп;
//   • кукушка — живёт в часах на стене, вылетает на пружине по линии;
//   • песочный призрак — рассыпается в песок от удара и собирается рядом,
//     сыплет песок в глаза (замедление);
//   • отмотчик — ранен — через полсекунды отматывается на 3 с назад со
//     здоровьем; след и «якорь» прошлого видны; встал на якорь — отмотка
//     сорвана;
//   • маятниковый жнец — коса ходит, как маятник: взмах вправо, взмах
//     влево, окно — в крайней точке;
//   • шестерёнчатый жук — сворачивается в шестерню и катится, отскакивая;
//   • хранитель стрелок — две стрелки: удар часовой (круг) и выметание
//     минутной (линия по дуге); переводит часы — сфера ускорения вокруг
//     себя (заходи в неё сам);
//   • двойник из прошлого — идёт по твоему следу на пять секунд позади и
//     бьёт туда, где ты был;
//   • гиря — висит под лебёдкой, тень ползёт за тобой, падает; лежит —
//     открыта, потом её поднимают;
//   • часовщик (редкий) — удирает с мешком, отматывает себе время.
// Босс — Повелитель часа (`f14boss`), четыре фазы на арене-циферблате:
// «ДВЕ СТРЕЛКИ», «ОСТАНОВКА», «ОТМОТКА», «ПОЛНОЧЬ». Сценарий —
// `f14-brains.ts`.
//
// Карта — `scripts/dungeon/f14.py` → `f14-map.ts` (руками не править).

import type { MobDef } from '../dungeon';
import { MAP_F14_DIAL, MAP_F14_MECH, MAP_F14_SAND } from './f14-map';
import type { FloorDef, LegendCell, SpawnSpec } from './types';

/** Свои клетки этажа: номер вида для рисовальщика и правил этажа. */
export const F14_MARK = {
  // Механизм.
  brass: 1,
  crack: 2,
  oil: 3,
  stripe: 4,
  track: 5,
  grate: 6,
  pit: 7,
  disc: 8,
  groove: 9,
  rank: 10,
  wspot: 11,
  hubgear: 12,
  // Песочные часы.
  dune: 20,
  stone: 21,
  rim: 22,
  stream: 23,
  sandbits: 24,
  glass: 25,
  slow: 26,
  fast: 27,
  // Циферблат.
  dial: 30,
  numeral: 31,
  hub: 32,
  parquet: 33,
  runner: 34,
  still: 35,
  frozen: 36,
  knife: 37,
  hourlamp: 38,
  // Стены (лицо стены).
  wclock: 50,
  cuckoo: 51,
  pipes: 52,
  keyface: 53,
  glasswall: 54,
  window: 55,
  // Сменённые на ходу (`setTile`): арена по фазам, решётка отмотки.
  dialStop: 60,
  dialRewind: 61,
  dialNight: 62,
  numStop: 63,
  numRewind: 64,
  numNight: 65,
  rimSand: 66,
  bars: 70,
} as const;

/** Районы этажа. `f14` — вход: на нём могут стоять сохранения. */
export const F14_MECH = 'f14';
export const F14_SAND = 'f14sand';
export const F14_DIAL = 'f14dial';

/**
 * Первые мировые ряды районов: мир складывается снизу вверх, поэтому
 * верхний район (Циферблат) начинается с нуля. Нужны рисовальщику клеток —
 * ему видны только мировые координаты.
 */
export const F14_TOP = {
  [F14_DIAL]: 0,
  [F14_SAND]: MAP_F14_DIAL.length,
  [F14_MECH]: MAP_F14_DIAL.length + MAP_F14_SAND.length,
} as Record<string, number>;

/** Геометрия залов в местных координатах районов (та же, что в f14.py). */
export const F14_GEO = {
  /** Зал шестерён: центр, радиусы колец, мест на кольце, проёмы. */
  gear: { area: F14_MECH, x: 32.5, y: 21.5, r: [10, 6], slots: [60, 36], gaps: [4, 3], gapW: [4, 3] },
  /** Нижняя и верхняя колбы. */
  lower: { area: F14_SAND, x: 32, y: 83 },
  upper: { area: F14_SAND, x: 32, y: 35, rx: 16.5, ry: 15.5, neck: 49 },
  /** Площадь «Полдень» и арена — циферблаты. */
  plaza: { area: F14_DIAL, x: 32.5, y: 58.5, r: 12.4, num: 10.6 },
  arena: { area: F14_DIAL, x: 32.5, y: 16.5, r: 10.6, num: 9.2, lamps: 7.6 },
} as const;

const M = F14_MARK;

// ---------------------------------------------------------------------------
// Легенды районов.
// ---------------------------------------------------------------------------

/** Общее у трёх районов: настенное, фонари, реквизит мастерской. */
const COMMON: Record<string, LegendCell> = {
  m: { tile: 'floor', mark: M.brass },
  x: { tile: 'floor', mark: M.crack },
  z: { tile: 'floor', mark: M.oil },
  y: { tile: 'floor', mark: M.stripe },
  F: {
    tile: 'wall',
    mark: M.wclock,
    obj: { kind: 'deco', ref: 'f14_wallclock', solid: 0 },
    light: { r: 1.8, tint: 'warm' },
  },
  Q: { tile: 'wall', mark: M.cuckoo, obj: { kind: 'deco', ref: 'f14_cuckooclock', solid: 0 } },
  H: { tile: 'wall', mark: M.pipes, obj: { kind: 'deco', ref: 'f14_pipes', solid: 0 } },
  i: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f14_lamp', solid: 0.22 },
    light: { r: 4.4, tint: 'warm' },
  },
  O: { tile: 'floor', obj: { kind: 'deco', ref: 'f14_column', solid: 0.46 } },
  U: { tile: 'floor', obj: { kind: 'breakable', ref: 'f14_crate', solid: 0.38, hp: 2 } },
  V: { tile: 'floor', obj: { kind: 'breakable', ref: 'f14_barrel', solid: 0.34, hp: 2 } },
  w: { tile: 'floor', obj: { kind: 'deco', ref: 'f14_bench', solid: 0.45 } },
  j: { tile: 'floor', obj: { kind: 'deco', ref: 'f14_gearpile', solid: 0.36 } },
  '7': { tile: 'floor', obj: { kind: 'deco', ref: 'f14_metronome', solid: 0.3 } },
};

const LEGEND_MECH: Record<string, LegendCell> = {
  ...COMMON,
  k: { tile: 'floor', mark: M.track },
  g: { tile: 'floor', mark: M.grate },
  // Провал с механизмом: не пройти, но видно, как внизу вертятся шестерни.
  _: { tile: 'deep', mark: M.pit },
  '0': {
    tile: 'deep',
    mark: M.pit,
    obj: { kind: 'deco', ref: 'f14_gear', solid: 0, flat: true },
  },
  r: { tile: 'floor', mark: M.disc },
  q: { tile: 'floor', mark: M.groove },
  // Зуб кольца: едет по жёлобу (двигает сценарий этажа).
  '*': { tile: 'floor', mark: M.groove, obj: { kind: 'deco', ref: 'f14_tooth', solid: 0.5 } },
  '(': {
    tile: 'floor',
    mark: M.hubgear,
    obj: { kind: 'deco', ref: 'f14_hubgear', solid: 0, flat: true },
  },
  // Маятник поперёк прохода: сам — предмет, лезвие ходит по такту.
  '|': { tile: 'floor', mark: M.track, obj: { kind: 'deco', ref: 'f14_pendulum', solid: 0 } },
  // Место солдатика в строю и гири под лебёдкой — ставит сценарий.
  A: { tile: 'floor', mark: M.rank },
  W: { tile: 'floor', mark: M.wspot, obj: { kind: 'deco', ref: 'f14_winch', solid: 0, flat: true } },
  '&': {
    tile: 'floor',
    mark: M.brass,
    obj: { kind: 'deco', ref: 'f14_lever', solid: 0.3, use: { label: 'Стопор' } },
  },
  J: { tile: 'wall', mark: M.keyface, obj: { kind: 'deco', ref: 'f14_key', solid: 0 } },
  '8': {
    tile: 'floor',
    mark: M.brass,
    obj: { kind: 'deco', ref: 'f14_orrery', solid: 0.85 },
    light: { r: 3.4, tint: 'warm' },
  },
};

const LEGEND_SAND: Record<string, LegendCell> = {
  ...COMMON,
  s: { tile: 'floor', mark: M.dune },
  d: { tile: 'floor', mark: M.stone },
  h: { tile: 'floor', mark: M.rim },
  k: { tile: 'floor', mark: M.sandbits },
  g: { tile: 'floor', mark: M.glass },
  // Струя песка с потолка: ходить можно, но вязнешь.
  ':': {
    tile: 'hazard',
    mark: M.stream,
    hazard: { slow: 0.5 },
    obj: { kind: 'deco', ref: 'f14_sandfall', solid: 0 },
  },
  // Сферы времени: сама сфера — зона, её ставит сценарий этажа.
  e: { tile: 'floor', mark: M.slow, light: { r: 2.2, tint: 'cold' } },
  f: { tile: 'floor', mark: M.fast, light: { r: 2.2, tint: 'warm' } },
  Z: {
    tile: 'floor',
    mark: M.rim,
    obj: { kind: 'deco', ref: 'f14_bigglass', solid: 1 },
    light: { r: 3, tint: 'warm' },
  },
  I: {
    tile: 'floor',
    mark: M.stone,
    obj: { kind: 'breakable', ref: 'f14_anchor', solid: 0.4, hp: 6, loot: 'f14_sand' },
    light: { r: 1.6, tint: 'teal' },
  },
  '9': {
    tile: 'floor',
    mark: M.glass,
    obj: { kind: 'deco', ref: 'f14_glass', solid: 0.3, use: { label: 'Перевернуть' } },
    light: { r: 2.4, tint: 'teal' },
  },
  W: { tile: 'wall', mark: M.glasswall },
};

const LEGEND_DIAL: Record<string, LegendCell> = {
  ...COMMON,
  d: { tile: 'floor', mark: M.dial },
  N: { tile: 'floor', mark: M.numeral },
  h: { tile: 'floor', mark: M.hub },
  p: { tile: 'floor', mark: M.parquet },
  t: { tile: 'floor', mark: M.runner },
  f: { tile: 'floor', mark: M.still },
  // Замершие враги и висящие ножи Стоп-кадра — ставит сценарий.
  '3': { tile: 'floor', mark: M.frozen },
  '2': { tile: 'floor', mark: M.knife },
  W: { tile: 'wall', mark: M.window, light: { r: 2.6, tint: 'cold' } },
  '4': {
    tile: 'floor',
    mark: M.hub,
    obj: { kind: 'deco', ref: 'f14_bell', solid: 0.7, use: { label: 'Ударить в колокол' } },
    light: { r: 3.4, tint: 'warm' },
  },
  '5': {
    tile: 'floor',
    mark: M.runner,
    obj: { kind: 'deco', ref: 'f14_bigpendulum', solid: 0.55, use: { label: 'Толкнуть маятник' } },
    light: { r: 2.4, tint: 'warm' },
  },
  // Часовые лампы арены: гаснут по одной, когда бьёт полночь (свет ставит
  // сценарий этажа — `api.light`, чтобы гасить).
  '6': {
    tile: 'floor',
    mark: M.hourlamp,
    obj: { kind: 'deco', ref: 'f14_hourlamp', solid: 0.2 },
  },
};

// ---------------------------------------------------------------------------
// Монстры. Сила — как этаж 10 ×1,4 базовыми числами (уровень районов 9).
// ---------------------------------------------------------------------------

const GORE_BRASS = ['#3a2410', '#b8862e', '#f0c860', '#6a4a24'];
const GORE_SAND = ['#8a6a3a', '#d8b878', '#f4e2b0', '#5a4424'];

const MOBS: MobDef[] = [
  {
    id: 'f14_soldier',
    name: 'Заводной солдатик',
    many: 'заводных солдатиков',
    hp: 44,
    dmg: 20,
    speed: 2.7,
    radius: 0.34,
    windup: 0.7,
    reach: 0.9,
    rest: 0.9,
    xp: 14,
    meat: null,
    mats: [
      ['f14_spring', 0.3],
      ['f14mat', 0.15],
    ],
    beast: true,
    brain: 'f14_soldier',
    art: { kind: 'paint', id: 'f14_soldier' },
    mass: 2,
    flinch: 0.25,
    stunT: 0.3,
    eye: '#ffe08a',
    gore: GORE_BRASS,
  },
  {
    id: 'f14_cuckoo',
    name: 'Кукушка',
    many: 'кукушек',
    hp: 30,
    dmg: 22,
    speed: 0,
    radius: 0.3,
    windup: 0.75,
    reach: 3.4,
    rest: 1.3,
    xp: 16,
    meat: ['f14_egg', 0.5, 1],
    mats: [['f14mat', 0.2]],
    beast: true,
    brain: 'f14_cuckoo',
    art: { kind: 'paint', id: 'f14_cuckoo' },
    mass: 99,
    flinch: 0,
    noAlbino: true,
    eye: '#ffcf40',
    gore: ['#5a3a1c', '#c8a468', '#f4e8c8', '#2a1c10'],
  },
  {
    id: 'f14_sand',
    name: 'Песочный призрак',
    many: 'песочных призраков',
    hp: 36,
    dmg: 18,
    speed: 3.3,
    radius: 0.32,
    windup: 0.6,
    reach: 0.6,
    rest: 0.8,
    xp: 14,
    meat: null,
    mats: [['f14_sand', 0.35]],
    beast: true,
    brain: 'f14_sand',
    art: { kind: 'paint', id: 'f14_sand' },
    mass: 1,
    flinch: 0.4,
    eye: '#fff0b0',
    light: 0.8,
    gore: GORE_SAND,
  },
  {
    id: 'f14_rewinder',
    name: 'Отмотчик',
    many: 'отмотчиков',
    hp: 40,
    dmg: 20,
    speed: 3.4,
    radius: 0.34,
    windup: 0.55,
    reach: 0.7,
    rest: 0.8,
    xp: 18,
    meat: null,
    mats: [
      ['f14_sand', 0.25],
      ['f14mat', 0.2],
    ],
    beast: true,
    brain: 'f14_rewinder',
    art: { kind: 'paint', id: 'f14_rewinder' },
    mass: 1.4,
    flinch: 0.35,
    eye: '#8fe8ff',
    light: 1.2,
    gore: ['#2a3a44', '#8fe8ff', '#c8a060', '#f4f8ff'],
  },
  {
    id: 'f14_reaper',
    name: 'Маятниковый жнец',
    many: 'маятниковых жнецов',
    hp: 70,
    dmg: 26,
    speed: 2,
    radius: 0.46,
    windup: 0.55,
    reach: 1.8,
    rest: 1.4,
    xp: 24,
    meat: null,
    mats: [['f14mat', 0.4]],
    beast: true,
    brain: 'f14_reaper',
    art: { kind: 'paint', id: 'f14_reaper' },
    mass: 5,
    flinch: 0.05,
    stunT: 0.3,
    eye: '#ffb040',
    gore: GORE_BRASS,
  },
  {
    id: 'f14_beetle',
    name: 'Шестерёнчатый жук',
    many: 'шестерёнчатых жуков',
    hp: 24,
    dmg: 16,
    speed: 3.8,
    radius: 0.28,
    windup: 0.5,
    reach: 0.4,
    rest: 0.7,
    xp: 9,
    meat: null,
    mats: [['f14mat', 0.25]],
    beast: true,
    brain: 'f14_beetle',
    art: { kind: 'paint', id: 'f14_beetle' },
    mass: 1.2,
    flinch: 0.4,
    eye: '#7cf0ff',
    gore: GORE_BRASS,
  },
  {
    id: 'f14_keeper',
    name: 'Хранитель стрелок',
    many: 'хранителей стрелок',
    hp: 90,
    dmg: 28,
    speed: 2.3,
    radius: 0.5,
    windup: 0.8,
    reach: 1.2,
    rest: 1.2,
    xp: 30,
    meat: ['f14_ration', 0.2, 1],
    mats: [
      ['f14_glass', 0.4],
      ['f14mat', 0.3],
    ],
    beast: true,
    brain: 'f14_keeper',
    art: { kind: 'paint', id: 'f14_keeper' },
    mass: 7,
    flinch: 0.05,
    stunT: 0.3,
    eye: '#ffe9a0',
    light: 1.4,
    gore: GORE_BRASS,
  },
  {
    id: 'f14_double',
    name: 'Двойник из прошлого',
    many: 'двойников из прошлого',
    hp: 50,
    dmg: 24,
    speed: 0,
    radius: 0.3,
    windup: 0.8,
    reach: 1.2,
    rest: 1,
    xp: 22,
    meat: null,
    mats: [['f14_sand', 0.3]],
    beast: true,
    brain: 'f14_double',
    art: { kind: 'paint', id: 'f14_double' },
    mass: 1,
    flinch: 0.2,
    noAlbino: true,
    eye: '#ffe27a',
    light: 1,
    gore: ['#6a5020', '#f0d070', '#fff4c8', '#3a2c10'],
  },
  {
    id: 'f14_weight',
    name: 'Гиря',
    many: 'гирь',
    hp: 80,
    dmg: 30,
    speed: 0,
    radius: 0.46,
    windup: 1,
    reach: 0,
    rest: 2,
    xp: 20,
    meat: null,
    mats: [['f14mat', 0.5]],
    beast: true,
    brain: 'f14_weight',
    art: { kind: 'paint', id: 'f14_weight' },
    mass: 99,
    flinch: 0,
    noAlbino: true,
    gore: ['#2a2420', '#6a6058', '#b8862e', '#141010'],
  },
  {
    id: 'f14_smith',
    name: 'Часовщик',
    many: 'часовщиков',
    hp: 30,
    dmg: 8,
    speed: 5.2,
    radius: 0.28,
    windup: 0.4,
    reach: 0.3,
    rest: 1,
    xp: 36,
    meat: null,
    mats: [
      ['f14mat', 0.6],
      ['f14_glass', 0.4],
    ],
    beast: true,
    brain: 'f14_smith',
    art: { kind: 'paint', id: 'f14_smith' },
    mass: 0.8,
    flinch: 1,
    coins: 2000,
    resume: 'flee',
    eye: '#ffd040',
    light: 1.4,
    gore: ['#3a2a44', '#ffd040', '#c8a060', '#2a1c10'],
  },
  {
    id: 'f14boss',
    name: 'Повелитель часа',
    many: 'повелителей часа',
    hp: 1300,
    dmg: 28,
    speed: 2.6,
    radius: 0.9,
    windup: 0.8,
    reach: 1.1,
    rest: 0.9,
    xp: 1200,
    meat: null,
    mats: [],
    beast: true,
    brain: 'f14boss',
    art: { kind: 'paint', id: 'f14boss' },
    mass: 14,
    boss: true,
    noAlbino: true,
    eye: '#ffe9a0',
    light: 3,
    gore: ['#1a1418', '#b8862e', '#fff0c0', '#3a2c50'],
  },
];

/** Механизм: строй солдатиков, жуки из люков, жнецы. */
const spawnMech: SpawnSpec = {
  mobs: [
    ['f14_soldier', 44],
    ['f14_beetle', 36],
    ['f14_reaper', 12],
    ['f14_rewinder', 8],
  ],
  density: 0.72,
  pack: [1, 2],
  filler: 'f14_beetle',
  // Спящая стая — жуки, во главе — солдатики.
  group: (i) => (i < 2 ? 'f14_soldier' : 'f14_beetle'),
  horde: null,
  treasure: 'f14_smith',
  nest: () => 'f14_beetle',
};

const spawnSand: SpawnSpec = {
  ...spawnMech,
  mobs: [
    ['f14_sand', 40],
    ['f14_rewinder', 28],
    ['f14_beetle', 20],
    ['f14_reaper', 12],
  ],
  density: 0.76,
  filler: 'f14_sand',
  group: (i) => (i < 2 ? 'f14_sand' : i < 3 ? 'f14_rewinder' : 'f14_beetle'),
};

const spawnDial: SpawnSpec = {
  ...spawnMech,
  mobs: [
    ['f14_reaper', 24],
    ['f14_rewinder', 24],
    ['f14_soldier', 22],
    ['f14_sand', 14],
    ['f14_double', 8],
    ['f14_keeper', 8],
  ],
  density: 0.8,
  filler: 'f14_soldier',
  group: (i) => (i < 1 ? 'f14_keeper' : i < 3 ? 'f14_soldier' : 'f14_rewinder'),
};

export const F14: FloorDef = {
  id: 14,
  name: 'Часовая башня',
  lead: 'Механизм башенных часов. Раз в минуту бьёт колокол — и мир замирает.',
  mapVer: 1,
  areas: [
    {
      id: F14_MECH,
      name: 'Механизм',
      lead: 'Шестерни, маятники и гири. Всё здесь ходит по такту.',
      tier: 8,
      level: 9,
      ambient: 0.44,
      rows: MAP_F14_MECH,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.86, 0.72, 0.52], mix: '#2a1a08', k: 0.14 },
        fog: '#0a0703',
      },
      legend: LEGEND_MECH,
      mine: 'f14mine',
      spawn: spawnMech,
    },
    {
      id: F14_SAND,
      name: 'Песочные часы',
      lead: 'Внутри колбы. Песок здесь сыплется вверх.',
      tier: 8,
      level: 9,
      ambient: 0.4,
      rows: MAP_F14_SAND,
      skin: {
        floor: 'ground',
        wall: 'brick',
        tint: { mul: [0.92, 0.78, 0.56], mix: '#3a2810', k: 0.16 },
        fog: '#0c0804',
      },
      legend: LEGEND_SAND,
      mine: 'f14mine2',
      spawn: spawnSand,
    },
    {
      id: F14_DIAL,
      name: 'Циферблат',
      lead: 'За стеклом — ночь. Стрелки идут по полу.',
      tier: 8,
      level: 9,
      ambient: 0.5,
      rows: MAP_F14_DIAL,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.62, 0.64, 0.78], mix: '#0c1224', k: 0.14 },
        fog: '#04060c',
      },
      legend: LEGEND_DIAL,
      spawn: spawnDial,
    },
  ],
  boss: {
    id: 'f14boss',
    name: 'Повелитель часа',
    lead: 'Арена-циферблат на вершине башни',
    area: F14_DIAL,
    restMs: 20 * 60_000,
    mob: 'f14boss',
    script: 'f14boss',
    parts: ['f14boss'],
    loot: (rnd) => ({
      tokens: 80 + Math.floor(rnd() * 50),
      keys: rnd() < 0.85 ? 1 : 0,
      coins: 70_000,
      mats: {
        f14_hand: 1,
        f14mat: 5 + Math.floor(rnd() * 5),
        f14_glass: 2 + Math.floor(rnd() * 2),
      },
    }),
  },
  mines: [
    {
      id: 'f14mine',
      name: 'Шахта под гирями',
      area: F14_MECH,
      windowMs: 60 * 60_000,
      ores: [26, 27],
      share: [0.24, 0.3, 0.38, 0.46, 0.55],
      pyrite: 0,
      blocks: 2.4,
    },
    {
      id: 'f14mine2',
      name: 'Шахта в песке',
      area: F14_SAND,
      windowMs: 3 * 60 * 60_000,
      ores: [26, 27],
      share: [0.3, 0.38, 0.46, 0.54, 0.62],
      pyrite: 0,
      blocks: 3,
    },
  ],
  mobs: MOBS,
  meats: [
    { id: 'f14_egg', name: 'Кукушкино яйцо', price: 80, heal: 0.3 },
    { id: 'f14_ration', name: 'Паёк смотрителя', price: 150, heal: 0.45 },
  ],
  mats: [
    {
      id: 'f14mat',
      name: 'Латунная шестерня',
      price: 520,
      lead: 'Зубчатое колесо из механизма башни. Ещё тёплое от хода.',
    },
    {
      id: 'f14_spring',
      name: 'Заводная пружина',
      price: 600,
      lead: 'Из спины солдатика. Сжата так, что звенит.',
    },
    {
      id: 'f14_sand',
      name: 'Песок времени',
      price: 700,
      lead: 'Если перевернуть мешочек, сыплется вверх.',
    },
    {
      id: 'f14_glass',
      name: 'Стекло циферблата',
      price: 760,
      lead: 'Молочное, с тонкой чертой часа. Светится изнутри.',
    },
    {
      id: 'f14_hand',
      name: 'Стрелка Повелителя часа',
      price: 70_000,
      lead: 'Трофей. Минутная стрелка-клинок. Больше не идёт.',
      stack: 1,
    },
  ],
  music: { explore: 'clock', boss: 'boss' },
  cover: '/ui/areas/f14.png',
};
