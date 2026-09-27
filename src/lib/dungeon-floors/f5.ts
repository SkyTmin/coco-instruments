// Этаж 5 — «Лабиринт». Живой подземный лабиринт: кладка без конца,
// коридоры в две-три клетки, тупики, петли, залы-перекрёстки. Стены
// «живые» — из прожилок в кладке выходят монстры. В глубине — старая
// арена-колизей, где ждёт Минотавр, которого на этой глубине быть не
// должно.
//
// Монстры и их приём (ИИ — `f5-brains.ts`, рисунок — `f5-art.ts`):
//   • кролик-рогач — прячется в траве, рывок рогом из засады, отскакивает
//     обратно в траву и прячется снова;
//   • адская гончая — стая обходит с боков, дышит огнём конусом (ожог);
//   • муравей-убийца — панцирь (не сбивается, не отлетает), укусом метит
//     героя феромоном: пока метка висит, муравьи этажа бегут на запах, а
//     из живых стен лезут новые;
//   • тень лабиринта — рождается из живой стены, бьёт когтями дважды,
//     раненая уходит в стену и выходит из другой у тебя за спиной;
//   • жаба-арканщица — язык-аркан по линии, притягивает к себе.
// Босс — Минотавр (`f5_minotaur`): рывок по линии до стены, секира,
// рёв с оглушением, три фазы. Правила этажа — рождение из живых стен,
// кролики в траве, плиты с шипами — `registerFloor(5)` в `f5-brains.ts`.
//
// Карта — `scripts/dungeon/f5.py` → `f5-map.ts` (руками не править).

import type { MobDef } from '../dungeon';
import { MAP_F5_ARENA, MAP_F5_MAZE } from './f5-map';
import type { FloorDef, LegendCell, SpawnSpec } from './types';

/** Свои клетки этажа: номер вида для рисовальщика и правил этажа. */
export const F5_MARK = {
  grass: 1,
  moss: 2,
  living: 3,
  sand: 4,
  pit: 5,
  spike: 6,
  stands: 7,
  torch: 8,
} as const;

/** Районы этажа. */
export const F5_MAZE = 'f5maze';
export const F5_ARENA = 'f5arena';

const M = F5_MARK;

/** Свои буквы карты — одни на оба района (у арены свои знаки не пересекаются). */
const LEGEND: Record<string, LegendCell> = {
  // Трава: ходить можно, чуть вязнет; в ней прячутся кролики-рогачи.
  '"': { tile: 'hazard', mark: M.grass, hazard: { slow: 0.88 } },
  // Мох на кладке светится зелёным — свет Лабиринта.
  g: { tile: 'wall', mark: M.moss, light: { r: 2.4, tint: 'green' } },
  // Живая стена: прожилки тлеют и дышат (пульс — предмет `f5_vein`);
  // отсюда выходят монстры.
  w: {
    tile: 'wall',
    mark: M.living,
    obj: { kind: 'deco', ref: 'f5_vein', solid: 0 },
    light: { r: 1.6, tint: 'red' },
  },
  // Факел на стене.
  t: {
    tile: 'wall',
    mark: M.torch,
    obj: { kind: 'deco', ref: 'f5_torch', solid: 0 },
    light: { r: 4.8, tint: 'warm' },
  },
  // Песок арены.
  s: { tile: 'floor', mark: M.sand },
  // Провал в нижний ярус Лабиринта.
  _: { tile: 'deep', mark: M.pit },
  // Плита с шипами: наступил — через миг шипы.
  '^': { tile: 'floor', mark: M.spike },
  // Горшок — бьётся, внутри мелочь.
  p: { tile: 'floor', obj: { kind: 'breakable', ref: 'f5_pot', solid: 0.3, hp: 1 } },
  // Кости авантюриста — не прошли.
  x: { tile: 'floor', obj: { kind: 'deco', ref: 'f5_bones', solid: 0 } },
  // Колонна арены: минотавр, врезавшись, её рушит (и сам оглушён).
  // На колонне — факел: арена светлая, быка видно издали.
  '|': {
    tile: 'floor',
    mark: M.sand,
    obj: { kind: 'deco', ref: 'f5_pillar', solid: 0.46 },
    light: { r: 4.5, tint: 'warm' },
  },
  // Оружие смельчаков в песке.
  '/': { tile: 'floor', mark: M.sand, obj: { kind: 'deco', ref: 'f5_blade', solid: 0 } },
  // Кости на песке арены.
  k: { tile: 'floor', mark: M.sand, obj: { kind: 'deco', ref: 'f5_bones', solid: 0 } },
  // Стена трибун: кладка арены с полосой.
  h: { tile: 'wall', mark: M.stands },
};

const MOBS: MobDef[] = [
  {
    id: 'f5_rabbit',
    name: 'Кролик-рогач',
    many: 'кроликов-рогачей',
    hp: 7,
    dmg: 8,
    speed: 3.4,
    radius: 0.24,
    windup: 0.5,
    reach: 0.3,
    rest: 0.8,
    xp: 3,
    meat: ['f5_hare', 0.6, 1],
    mats: [['f5_horn', 0.3]],
    beast: true,
    brain: 'f5_rabbit',
    art: { kind: 'paint', id: 'f5_rabbit' },
    mass: 0.8,
    flinch: 0.6,
    eye: '#ff3048',
    gore: ['#efe6da', '#c9453a', '#a89a8c'],
  },
  {
    id: 'f5_hound',
    name: 'Адская гончая',
    many: 'адских гончих',
    hp: 15,
    dmg: 9,
    speed: 4.3,
    radius: 0.3,
    windup: 0.38,
    reach: 0.42,
    rest: 0.8,
    xp: 6,
    meat: ['f5_houndmeat', 0.55, 1],
    mats: [['f5_ember', 0.25]],
    beast: true,
    brain: 'f5_hound',
    art: { kind: 'paint', id: 'f5_hound' },
    mass: 1.4,
    flinch: 0.3,
    eye: '#ffb030',
    light: 1.4,
    gore: ['#2a2224', '#ff8a30', '#5a4644'],
  },
  {
    id: 'f5_ant',
    name: 'Муравей-убийца',
    many: 'муравьёв-убийц',
    hp: 26,
    dmg: 11,
    speed: 2.8,
    radius: 0.36,
    windup: 0.5,
    reach: 0.4,
    rest: 1,
    xp: 8,
    meat: null,
    mats: [['f5_chitin', 0.4]],
    beast: true,
    brain: 'f5_ant',
    art: { kind: 'paint', id: 'f5_ant' },
    mass: 3,
    flinch: 0,
    stunT: 0.12,
    eye: '#ffa040',
    gore: ['#6a2418', '#b85a34', '#2a1410'],
  },
  {
    id: 'f5_shade',
    name: 'Тень лабиринта',
    many: 'теней лабиринта',
    hp: 15,
    dmg: 10,
    speed: 3.8,
    radius: 0.3,
    windup: 0.45,
    reach: 0.55,
    rest: 0.9,
    xp: 7,
    meat: null,
    mats: [],
    beast: true,
    brain: 'f5_shade',
    art: { kind: 'paint', id: 'f5_shade' },
    mass: 1.2,
    flinch: 0.35,
    coins: 240,
    eye: '#c8a0ff',
    gore: ['#1c1428', '#4a3a6a', '#9a70ff'],
  },
  {
    id: 'f5_frog',
    name: 'Жаба-арканщица',
    many: 'жаб-арканщиц',
    hp: 11,
    dmg: 6,
    speed: 2.5,
    radius: 0.28,
    windup: 0.4,
    reach: 0.35,
    rest: 1,
    xp: 4,
    meat: ['f5_legs', 0.6, 1],
    mats: [],
    beast: true,
    brain: 'f5_frog',
    art: { kind: 'paint', id: 'f5_frog' },
    mass: 1.1,
    flinch: 0.5,
    eye: '#e8d840',
    gore: ['#6a8a3a', '#d8c870', '#2e4418'],
  },
  {
    id: 'f5_minotaur',
    name: 'Минотавр',
    many: 'минотавров',
    hp: 520,
    dmg: 14,
    speed: 2.6,
    radius: 0.95,
    windup: 0.85,
    reach: 0.8,
    rest: 0.8,
    xp: 600,
    meat: null,
    mats: [],
    beast: true,
    brain: 'f5_minotaur',
    art: { kind: 'paint', id: 'f5_minotaur' },
    mass: 10,
    boss: true,
    noAlbino: true,
    eye: '#ff3a20',
    gore: ['#5a2e1c', '#a0603a', '#c9453a'],
  },
];

/** Кто водится в лабиринте: норы-муравейники, засады, шум у шахты. */
const spawnMaze: SpawnSpec = {
  mobs: [
    ['f5_ant', 45],
    ['f5_hound', 25],
    ['f5_frog', 18],
    ['f5_rabbit', 12],
  ],
  density: 0.75,
  pack: [1, 2],
  filler: 'f5_ant',
  // Спящая стая — гончие; четвёртым в логове спит муравей.
  group: (i) => (i < 3 ? 'f5_hound' : 'f5_ant'),
  horde: null,
  treasure: null,
  nest: () => 'f5_ant',
};

const spawnArena: SpawnSpec = {
  ...spawnMaze,
  mobs: [
    ['f5_hound', 40],
    ['f5_ant', 40],
    ['f5_frog', 12],
    ['f5_rabbit', 8],
  ],
  density: 0.9,
  pack: [2, 2],
  filler: 'f5_hound',
};

export const F5: FloorDef = {
  id: 5,
  name: 'Лабиринт',
  lead: 'Живые стены, тупики и петли. Из кладки выходят чудища, в глубине ревёт бык.',
  mapVer: 1,
  areas: [
    {
      id: F5_MAZE,
      name: 'Живой лабиринт',
      lead: 'Стены дышат. Держись указателей.',
      tier: 8,
      level: 8,
      ambient: 0.44,
      rows: MAP_F5_MAZE,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [1.08, 0.9, 0.72], mix: '#8a4a22', k: 0.14 },
        fog: '#0d0805',
      },
      legend: LEGEND,
      mine: 'f5mine1',
      spawn: spawnMaze,
    },
    {
      id: F5_ARENA,
      name: 'Колизей',
      lead: 'Старая арена в сердце лабиринта. Слышен рёв.',
      tier: 8,
      level: 9,
      ambient: 0.4,
      rows: MAP_F5_ARENA,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [1.12, 0.86, 0.68], mix: '#9a3e1c', k: 0.18 },
        fog: '#100604',
      },
      legend: LEGEND,
      mine: 'f5mine2',
      spawn: spawnArena,
    },
  ],
  boss: {
    id: 'f5_minotaur',
    name: 'Минотавр',
    lead: 'Арена в сердце Колизея',
    area: F5_ARENA,
    restMs: 20 * 60_000,
    mob: 'f5_minotaur',
    script: 'f5_minotaur',
    parts: ['f5_minotaur'],
    loot: (rnd) => ({
      tokens: 45 + Math.floor(rnd() * 30),
      keys: rnd() < 0.6 ? 1 : 0,
      coins: 40_000,
      mats: {
        f5_minohorn: 1,
        f5_ember: 2 + Math.floor(rnd() * 3),
        f5_chitin: 2 + Math.floor(rnd() * 3),
      },
    }),
  },
  mines: [
    {
      id: 'f5mine1',
      name: 'Шахта лабиринта',
      area: F5_MAZE,
      windowMs: 60 * 60_000,
      ores: [8, 9],
      share: [0.2, 0.27, 0.34, 0.42, 0.5],
      pyrite: 0,
      blocks: 1.6,
    },
    {
      id: 'f5mine2',
      name: 'Шахта у Колизея',
      area: F5_ARENA,
      windowMs: 3 * 60 * 60_000,
      ores: [8, 9],
      share: [0.26, 0.34, 0.42, 0.5, 0.58],
      pyrite: 0,
      blocks: 2.2,
    },
  ],
  mobs: MOBS,
  meats: [
    { id: 'f5_hare', name: 'Крольчатина', price: 22, heal: 0.2 },
    { id: 'f5_houndmeat', name: 'Мясо гончей', price: 40, heal: 0.3 },
    { id: 'f5_legs', name: 'Жабьи лапки', price: 18, heal: 0.15 },
  ],
  mats: [
    {
      id: 'f5_horn',
      name: 'Рог рогача',
      price: 180,
      lead: 'Витой и острый — на наконечники.',
    },
    {
      id: 'f5_chitin',
      name: 'Хитин муравья',
      price: 220,
      lead: 'Лёгкая пластина панциря: держит удар.',
    },
    {
      id: 'f5_ember',
      name: 'Уголь гончей',
      price: 260,
      lead: 'Из пасти адской гончей. Ещё тлеет.',
    },
    {
      id: 'f5_minohorn',
      name: 'Рог Минотавра',
      price: 30_000,
      lead: 'Трофей. Отломан у быка, которого здесь быть не должно.',
      stack: 1,
    },
  ],
  music: { explore: 'depths', boss: 'boss' },
  cover: '/ui/areas/f5maze.png',
};
