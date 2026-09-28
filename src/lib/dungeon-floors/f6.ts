// Этаж 6 — «Огненный разлом». Глубины, где спит красный дракон: лава и
// корка остывшей лавы, пепел, обсидиановые мосты, трещины со светом
// снизу, базальтовые столбы, кости крупных зверей и брошенный лагерь
// искателей приключений (котёл ещё тёплый, палатки целы — хозяева нет).
//
// Монстры и их приём (ИИ — `f6-brains.ts`, рисунок — `f6-art.ts`):
//   • саламандра — ящерица лавы: на суше кусает и прыгает, у озера ныряет
//     в лаву (недосягаема) и выныривает у героя там, где загорелся круг;
//   • огненный дух — подплывает и раздувается: не добил за две секунды —
//     взрыв кругом; добил — гаснет тихо;
//   • лавовый голем — базальтовая корка держит удар (`onHit`), трескается
//     плита за плитой; треснула — внутри жидкий камень, бей; у лавы
//     корка нарастает снова;
//   • пепельный летун — кружит над лавой, пикирует линией и оставляет
//     облако пепла (вязнет); после пике садится на камень — открыт;
//   • жук-огнёвка — стаей, зигзагом, лопается угольками (не бей в упор);
//   • живая руда — лежит самородком кварца или серебра, пока не подойдёшь;
//     убитая роняет настоящую руду этажа;
//   • магмовый червь — живёт в омуте, всплывает и плюётся лавой навесом
//     (на полу загорается место падения, там остаётся лужа);
//   • бесёнок-старьёвщик — редкий беглец с мешком монет, бросает петарды.
// Босс — Красный змей (`f6boss`): четыре фазы, засечки на полосе, арена
// меняется (лава заливает края). Правила этажа — жерла гейзерного поля,
// мост, который рушится за спиной, извержение в зале, живая руда, черви
// в омутах — `registerFloor(6)` в `f6-brains.ts`.
//
// Карта — `scripts/dungeon/f6.py` → `f6-map.ts` (руками не править).

import type { MobDef } from '../dungeon';
import { MAP_F6_GALLERY, MAP_F6_LAKES, MAP_F6_NEST } from './f6-map';
import type { FloorDef, LegendCell, SpawnSpec } from './types';

/** Свои клетки этажа: номер вида для рисовальщика и правил этажа. */
export const F6_MARK = {
  lava: 1,
  crust: 2,
  ash: 3,
  fissure: 4,
  basalt: 5,
  vein: 6,
  bridge: 7,
  vent: 8,
  soot: 9,
  /** Лава, застывающая на ходу: пол, но жжёт (правило этажа, не клетка мира). */
  hotcrust: 10,
  /** Застывшая на ходу лава: пол, остывший обсидиан. */
  cooled: 11,
  rim1: 12,
  rim2: 13,
  rim3: 14,
  arena: 15,
  orespot: 16,
  fall: 17,
  /** Любая стена этажа: рисовальщик района кладёт на общую стену свою
   * вулканическую породу (тёмная, красноватая, со столбчатой отдельностью). */
  rock: 18,
} as const;

/** Районы этажа. `f6` — вход: на нём могут стоять сохранения игроков. */
export const F6_GALLERY = 'f6';
export const F6_LAKES = 'f6lakes';
export const F6_NEST = 'f6nest';

const M = F6_MARK;

/** Свои буквы карты — одни на все три района. */
const LEGEND: Record<string, LegendCell> = {
  '#': { tile: 'wall', mark: M.rock },
  // Лава: не пройти, но это не стена — снаряды и летуны над ней проходят.
  _: { tile: 'deep', mark: M.lava },
  // Лава, которая светит: свет не на каждой клетке, иначе съест кадр.
  '*': { tile: 'deep', mark: M.lava, light: { r: 3.6, tint: 'red' } },
  // Пузырь на лаве: вздувается и лопается (живой предмет).
  m: {
    tile: 'deep',
    mark: M.lava,
    obj: { kind: 'deco', ref: 'f6_bubble', solid: 0 },
    light: { r: 2.4, tint: 'red' },
  },
  // Корка остывшей лавы: ходить можно, но жжёт.
  ':': { tile: 'hazard', mark: M.crust, hazard: { status: 'burn', dur: 0.7 } },
  ';': { tile: 'floor', mark: M.ash },
  '+': { tile: 'floor', mark: M.soot },
  // Трещина со светом снизу (часть — без источника: свет не на каждой).
  h: { tile: 'floor', mark: M.fissure, light: { r: 1.7, tint: 'red' } },
  i: { tile: 'floor', mark: M.fissure },
  // Жерло гейзера: бьёт столбом пара и огня (правило этажа).
  V: { tile: 'floor', mark: M.vent },
  // Обсидиановый мост над лавой.
  O: { tile: 'floor', mark: M.bridge },
  // Кольца зала извержения: лава поднимается от краёв.
  '1': { tile: 'floor', mark: M.rim1 },
  '2': { tile: 'floor', mark: M.rim2 },
  '3': { tile: 'floor', mark: M.rim3 },
  // Пол арены — полированный базальт с мозаикой чешуи.
  '&': { tile: 'floor', mark: M.arena },
  // Место живой руды: сама клетка — обычный пол.
  N: { tile: 'floor', mark: M.orespot },
  // Стена с магмовой жилой.
  w: { tile: 'wall', mark: M.vein, light: { r: 1.5, tint: 'red' } },
  // Столбчатый базальт на лице стены.
  I: { tile: 'wall', mark: M.basalt },
  // Лавопад: лава стекает по стене (живой предмет).
  Z: {
    tile: 'wall',
    mark: M.fall,
    obj: { kind: 'deco', ref: 'f6_lavafall', solid: 0 },
    light: { r: 3.4, tint: 'red' },
  },
  // Базальтовый столб — шестигранник.
  '|': { tile: 'floor', obj: { kind: 'deco', ref: 'f6_column', solid: 0.4 } },
  // Кости великана: рёбра дугой, череп, россыпь.
  r: { tile: 'floor', mark: M.ash, obj: { kind: 'deco', ref: 'f6_ribs', solid: 0.16 } },
  s: { tile: 'floor', obj: { kind: 'deco', ref: 'f6_skull', solid: 0.55 } },
  k: { tile: 'floor', obj: { kind: 'deco', ref: 'f6_bones', solid: 0 } },
  // Брошенный лагерь искателей: палатка, лежак, котёл, костёр, меч.
  t: { tile: 'floor', obj: { kind: 'deco', ref: 'f6_tent', solid: 0.46 } },
  x: { tile: 'floor', obj: { kind: 'deco', ref: 'f6_bedroll', solid: 0 } },
  q: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f6_cauldron', solid: 0.36 },
    light: { r: 3.6, tint: 'warm' },
  },
  f: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f6_campfire', solid: 0.22 },
    light: { r: 4.4, tint: 'warm' },
  },
  F: { tile: 'floor', mark: M.ash, obj: { kind: 'deco', ref: 'f6_sword', solid: 0 } },
  A: { tile: 'floor', mark: M.ash, obj: { kind: 'deco', ref: 'f6_ashpile', solid: 0 } },
  // Руда этажа в камне: друза кварца (искрится) и серебряная жила.
  Q: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f6_quartz', solid: 0.3 },
    light: { r: 1.4, tint: 'cold' },
  },
  J: { tile: 'floor', obj: { kind: 'deco', ref: 'f6_silver', solid: 0.32 } },
  // Бьётся: обсидиановая жеода и ящик припасов искателей.
  g: {
    tile: 'floor',
    obj: { kind: 'breakable', ref: 'f6_geode', solid: 0.34, hp: 2, loot: 'f6mat' },
  },
  j: { tile: 'floor', obj: { kind: 'breakable', ref: 'f6_crate', solid: 0.36, hp: 1 } },
  // Базальтовая жаровня.
  e: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f6_brazier', solid: 0.3 },
    light: { r: 4.2, tint: 'warm' },
  },
  // Гнездо: яйца змея (светятся изнутри) и скорлупа.
  d: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f6_egg', solid: 0.32 },
    light: { r: 1.9, tint: 'red' },
  },
  y: { tile: 'floor', obj: { kind: 'deco', ref: 'f6_shell', solid: 0 } },
};

/** Корка на ходу: сколько жжёт, пока стоишь (правило этажа). */
export const HOT_CRUST = { status: 'burn' as const, dur: 0.8 };

const MOBS: MobDef[] = [
  {
    id: 'f6_salamander',
    name: 'Саламандра',
    many: 'саламандр',
    hp: 17,
    dmg: 10,
    speed: 3.3,
    radius: 0.3,
    windup: 0.45,
    reach: 0.45,
    rest: 0.85,
    xp: 7,
    meat: ['f6_tail', 0.5, 1],
    mats: [['f6_scale', 0.3]],
    beast: true,
    brain: 'f6_salamander',
    art: { kind: 'paint', id: 'f6_salamander' },
    mass: 1.5,
    flinch: 0.3,
    // Лава ей — вода: над «глубиной» проходит (ныряет и плывёт).
    fly: true,
    eye: '#ffd23a',
    light: 1.1,
    gore: ['#c8401c', '#ffb030', '#5a1c10'],
  },
  {
    id: 'f6_wisp',
    name: 'Огненный дух',
    many: 'огненных духов',
    hp: 9,
    dmg: 12,
    speed: 3.3,
    radius: 0.28,
    windup: 0.4,
    reach: 0.3,
    rest: 1,
    xp: 6,
    meat: null,
    mats: [['f6_cinder', 0.35]],
    beast: true,
    brain: 'f6_wisp',
    art: { kind: 'paint', id: 'f6_wisp' },
    mass: 0.6,
    // Раздувание не сбить: либо добей, либо уходи.
    flinch: 0,
    fly: true,
    eye: '#fff4b0',
    light: 2.4,
    gore: ['#ffd060', '#ff7a20', '#5a2a10'],
  },
  {
    id: 'f6_golem',
    name: 'Лавовый голем',
    many: 'лавовых големов',
    hp: 42,
    dmg: 14,
    speed: 1.8,
    radius: 0.46,
    windup: 0.8,
    reach: 0.55,
    rest: 1.3,
    xp: 15,
    meat: null,
    mats: [
      ['f6_core', 0.35],
      ['f6mat', 0.45],
    ],
    beast: true,
    brain: 'f6_golem',
    art: { kind: 'paint', id: 'f6_golem' },
    mass: 6,
    flinch: 0,
    stunT: 0.1,
    eye: '#ffb030',
    light: 1.3,
    gore: ['#2a2224', '#ff8a30', '#4a3a34'],
  },
  {
    id: 'f6_ashbat',
    name: 'Пепельный летун',
    many: 'пепельных летунов',
    hp: 9,
    dmg: 8,
    speed: 4.4,
    radius: 0.26,
    windup: 0.55,
    reach: 0.35,
    rest: 1.1,
    xp: 5,
    meat: null,
    mats: [['f6_ash', 0.35]],
    beast: true,
    brain: 'f6_ashbat',
    art: { kind: 'paint', id: 'f6_ashbat' },
    mass: 0.7,
    flinch: 0.5,
    fly: true,
    eye: '#ff7030',
    gore: ['#6a625a', '#ff8a40', '#2a2622'],
  },
  {
    id: 'f6_beetle',
    name: 'Жук-огнёвка',
    many: 'жуков-огнёвок',
    hp: 4,
    dmg: 5,
    speed: 3.9,
    radius: 0.21,
    windup: 0.3,
    reach: 0.25,
    rest: 0.7,
    xp: 2,
    meat: ['f6_bug', 0.2, 1],
    mats: [],
    beast: true,
    brain: 'f6_beetle',
    art: { kind: 'paint', id: 'f6_beetle' },
    mass: 0.5,
    flinch: 0.6,
    zigzag: true,
    eye: '#ffe060',
    light: 0.8,
    gore: ['#2a1a14', '#ff9a30', '#ffe07a'],
  },
  {
    id: 'f6_ore',
    name: 'Живая руда',
    many: 'живой руды',
    hp: 18,
    dmg: 9,
    speed: 2.6,
    radius: 0.3,
    windup: 0.42,
    reach: 0.35,
    rest: 0.9,
    xp: 9,
    meat: null,
    mats: [['f6mat', 0.3]],
    beast: true,
    brain: 'f6_ore',
    art: { kind: 'paint', id: 'f6_ore' },
    mass: 2.5,
    flinch: 0.25,
    eye: '#a8f0ff',
    gore: ['#d8d0e0', '#9a9aa8', '#4a4652'],
  },
  {
    id: 'f6_worm',
    name: 'Магмовый червь',
    many: 'магмовых червей',
    hp: 22,
    dmg: 11,
    speed: 2.3,
    radius: 0.36,
    windup: 0.7,
    reach: 0.45,
    rest: 1.4,
    xp: 10,
    meat: null,
    mats: [
      ['f6_core', 0.2],
      ['f6mat', 0.35],
    ],
    beast: true,
    brain: 'f6_worm',
    art: { kind: 'paint', id: 'f6_worm' },
    mass: 4,
    flinch: 0.2,
    fly: true,
    shot: {
      speed: 6.5,
      r: 0.5,
      life: 2,
      dmg: 1,
      art: 'f6_glob',
      status: 'burn',
      dur: 1.6,
      lob: true,
    },
    eye: '#ffee80',
    light: 1.8,
    gore: ['#3a1a14', '#ff8a30', '#ffd070'],
  },
  {
    id: 'f6_imp',
    name: 'Бесёнок-старьёвщик',
    many: 'бесят-старьёвщиков',
    hp: 14,
    dmg: 6,
    speed: 4.7,
    radius: 0.26,
    windup: 0.3,
    reach: 0.3,
    rest: 1,
    xp: 12,
    meat: null,
    mats: [['f6_scale', 0.5]],
    beast: true,
    brain: 'f6_imp',
    art: { kind: 'paint', id: 'f6_imp' },
    mass: 0.9,
    flinch: 0.5,
    coins: 2_400,
    resume: 'flee',
    noAlbino: true,
    eye: '#ffcc30',
    gore: ['#c83a2a', '#ffcc40', '#5a1a14'],
  },
  {
    id: 'f6boss',
    name: 'Красный змей',
    many: 'красных змеев',
    hp: 580,
    dmg: 15,
    speed: 2.7,
    radius: 0.95,
    windup: 0.8,
    reach: 0.9,
    rest: 0.9,
    xp: 700,
    // Мясо дракона — можно (и нужно): лечит сильно.
    meat: ['f6_dragon', 1, 2],
    mats: [],
    beast: true,
    brain: 'f6boss',
    art: { kind: 'paint', id: 'f6boss' },
    mass: 12,
    boss: true,
    noAlbino: true,
    eye: '#ffe060',
    light: 3.2,
    gore: ['#8a1a10', '#ff6a20', '#ffd070'],
  },
];

/** Пепельные галереи: норы, засады, стая огнёвок из норы. */
const spawnGallery: SpawnSpec = {
  mobs: [
    ['f6_salamander', 30],
    ['f6_beetle', 24],
    ['f6_wisp', 18],
    ['f6_ashbat', 15],
    ['f6_golem', 13],
  ],
  density: 0.75,
  pack: [1, 2],
  filler: 'f6_beetle',
  group: (i) => (i < 2 ? 'f6_salamander' : 'f6_beetle'),
  // Рой огнёвок из норы — редкая «орда» этажа.
  horde: () => 'f6_beetle',
  treasure: 'f6_imp',
  nest: () => 'f6_beetle',
};

const spawnLakes: SpawnSpec = {
  mobs: [
    ['f6_salamander', 36],
    ['f6_ashbat', 26],
    ['f6_wisp', 14],
    ['f6_golem', 14],
    ['f6_beetle', 10],
  ],
  density: 0.75,
  pack: [1, 2],
  filler: 'f6_ashbat',
  // Стаи у озёр — саламандры: их гнёзда на островках, до берега — вплавь.
  group: () => 'f6_salamander',
  horde: null,
  treasure: 'f6_imp',
  nest: () => 'f6_salamander',
};

const spawnNest: SpawnSpec = {
  mobs: [
    ['f6_golem', 26],
    ['f6_wisp', 26],
    ['f6_salamander', 24],
    ['f6_ashbat', 14],
    ['f6_beetle', 10],
  ],
  density: 0.8,
  pack: [1, 2],
  filler: 'f6_wisp',
  // Гнездо сторожит голем, при нём саламандры.
  group: (i) => (i === 0 ? 'f6_golem' : 'f6_salamander'),
  horde: null,
  treasure: 'f6_imp',
  nest: () => 'f6_wisp',
};

export const F6: FloorDef = {
  id: 6,
  name: 'Огненный разлом',
  lead: 'Лава, пепел и обсидиан. Внизу спит красный змей — и он голоден.',
  mapVer: 2,
  areas: [
    {
      id: F6_GALLERY,
      name: 'Пепельные галереи',
      lead: 'Брошенный лагерь у лифта. Котёл ещё тёплый.',
      tier: 8,
      level: 9,
      ambient: 0.42,
      rows: MAP_F6_GALLERY,
      skin: {
        floor: 'ground',
        wall: 'rock',
        tint: { mul: [0.86, 0.72, 0.66], mix: '#2a1210', k: 0.24 },
        fog: '#0c0706',
      },
      legend: LEGEND,
      mine: 'f6mine',
      spawn: spawnGallery,
    },
    {
      id: F6_LAKES,
      name: 'Лавовые озёра',
      lead: 'Мосты из обсидиана над жидким огнём. Не стой на месте.',
      tier: 8,
      level: 9,
      ambient: 0.5,
      rows: MAP_F6_LAKES,
      skin: {
        floor: 'ground',
        wall: 'rock',
        tint: { mul: [0.98, 0.7, 0.58], mix: '#4a120a', k: 0.26 },
        fog: '#150604',
      },
      legend: LEGEND,
      mine: 'f6mine2',
      spawn: spawnLakes,
    },
    {
      id: F6_NEST,
      name: 'Гнездо змея',
      lead: 'Жар идёт из-под пола. Здесь он откладывает яйца.',
      tier: 8,
      level: 9,
      ambient: 0.36,
      rows: MAP_F6_NEST,
      skin: {
        floor: 'ground',
        wall: 'rock',
        tint: { mul: [0.9, 0.6, 0.58], mix: '#3a0808', k: 0.3 },
        fog: '#120405',
      },
      legend: LEGEND,
      spawn: spawnNest,
    },
  ],
  boss: {
    id: 'f6boss',
    name: 'Красный змей',
    lead: 'Арена в сердце Гнезда',
    area: F6_NEST,
    restMs: 20 * 60_000,
    mob: 'f6boss',
    script: 'f6boss',
    parts: ['f6boss'],
    loot: (rnd) => ({
      tokens: 52 + Math.floor(rnd() * 35),
      keys: rnd() < 0.6 ? 1 : 0,
      coins: 46_000,
      mats: {
        f6_fang: 1,
        f6_scale: 2 + Math.floor(rnd() * 3),
        f6_core: 2 + Math.floor(rnd() * 3),
        f6mat: 3 + Math.floor(rnd() * 3),
      },
    }),
  },
  mines: [
    {
      id: 'f6mine',
      name: 'Кварцевая жила',
      area: F6_GALLERY,
      windowMs: 60 * 60_000,
      ores: [10, 11],
      share: [0.2, 0.27, 0.34, 0.42, 0.5],
      pyrite: 0,
      blocks: 1.6,
    },
    {
      id: 'f6mine2',
      name: 'Серебряная штольня',
      area: F6_LAKES,
      windowMs: 3 * 60 * 60_000,
      ores: [10, 11],
      share: [0.26, 0.34, 0.42, 0.5, 0.58],
      pyrite: 0,
      blocks: 2.2,
    },
  ],
  mobs: MOBS,
  meats: [
    { id: 'f6_tail', name: 'Хвост саламандры', price: 44, heal: 0.3 },
    { id: 'f6_bug', name: 'Печёная огнёвка', price: 16, heal: 0.12 },
    { id: 'f6_dragon', name: 'Драконье мясо', price: 420, heal: 0.65 },
  ],
  mats: [
    // Первый — ходовой: им чинят лифты, его роняют ящики и жеоды.
    {
      id: 'f6mat',
      name: 'Обсидиан',
      price: 240,
      lead: 'Застывшее вулканическое стекло. Острый скол.',
    },
    {
      id: 'f6_scale',
      name: 'Чешуя саламандры',
      price: 250,
      lead: 'Не горит. Из неё шьют перчатки для кузницы.',
    },
    {
      id: 'f6_cinder',
      name: 'Искра духа',
      price: 280,
      lead: 'Тёплая даже в ладони. Гаснет в воде.',
    },
    {
      id: 'f6_core',
      name: 'Магмовое ядро',
      price: 320,
      lead: 'Сердцевина голема. Под коркой ещё жидкое.',
    },
    {
      id: 'f6_ash',
      name: 'Пепельное перо',
      price: 200,
      lead: 'Лёгкое, серое, пахнет гарью.',
    },
    {
      id: 'f6_fang',
      name: 'Клык Красного змея',
      price: 34_000,
      lead: 'Трофей. Горячий — его не держат голыми руками.',
      stack: 1,
    },
  ],
  music: { explore: 'depths', boss: 'boss' },
  cover: '/ui/areas/f6.png',
};
