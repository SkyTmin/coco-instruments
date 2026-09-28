// Этаж 10 — «Трон демона». Финал захода: замок демонов под лагерем.
// Чёрный камень, красные ковры, золото, цепи, витражи, колонны, жаровни,
// молнии в окнах, пропасть под мостами, шипы у Врат и кости героев, что
// до трона не дошли. Названия свои.
//
// Районы (снизу вверх):
//   • «Врата преисподней» (`f10`, вход) — зал лифта с псарней (псы на
//     цепи), Врата с шипами в ритме, пропасть и мост с поворотом:
//     зал-событие «Мост» — доски за спиной рушатся, из-за пропасти скачут
//     рыцари ада; Двор казней с палачом, шахта, оссуарий за трещиной;
//   • «Галерея витражей» (`f10gallery`) — длинная галерея с провалом,
//     суккубы над пропастью, горгульи среди статуй; развилка: Витражный
//     зал (зал-событие «Гроза»: молнии бьют по клеткам в ритме, стёкла
//     падают) или Часовня свечей с магами; реликварий за трещиной;
//   • «Тронный зал» (`f10throne`) — Зал присяги со стражей, Сокровищница
//     (зал-ловушка: открыл сундук — горгульи ожили, решётка упала), шахта
//     под троном, Путь процессий и сам Тронный зал.
//
// Монстры (ИИ — `f10-brains.ts`, рисунок — `f10-art.ts`):
//   • демон-страж — алебарда: широкий взмах конусом и выпад линией;
//   • рыцарь ада на коне — таран по линии; промахнулся на мосту — летит в
//     пропасть; о стену — оглушён;
//   • суккуба — висит над пропастью (летает), поцелуй-сердце очаровывает
//     (управление наоборот, 1,2 с), очарованного — налёт когтями;
//   • горгулья — камень на постаменте (недосягаема), оживает, когда
//     подходишь: прыжок с меткой приземления; раненая каменеет и
//     затягивает трещины;
//   • архидемон-маг — молнии по клеткам с метками, «цепь» по линии,
//     отходит вспышкой (метка — куда);
//   • адский пёс — стая, прыжок-укус с ожогом; у псарни — на цепи;
//   • палач — цепной цеп кольцом (безопасно вплотную или далеко), а
//     вплотную — топор сверху;
//   • имп-носильщик (редкий) — удирает с мешком, от ударов сыплет монеты.
// Босс — Король демонов (`f10boss`): трон (сидит, зовёт стражу; уязвим,
// когда призывает), меч и молнии по клеткам арены, крылья (взлёт,
// пикирует по метке), бездна (края арены рушатся). Сценарий —
// `f10-brains.ts`.
//
// Карта — `scripts/dungeon/f10.py` → `f10-map.ts` (руками не править).

import type { MobDef } from '../dungeon';
import { MAP_F10_GALLERY, MAP_F10_GATES, MAP_F10_THRONE } from './f10-map';
import type { FloorDef, LegendCell, SpawnSpec } from './types';

/** Свои клетки этажа: номер вида для рисовальщика и правил этажа. */
export const F10_MARK = {
  carpet: 1,
  marble: 2,
  bones: 3,
  blood: 4,
  soot: 5,
  crack: 6,
  bridge: 7,
  abyss: 8,
  spike: 9,
  straw: 10,
  glass: 11,
  dais: 12,
  rune: 13,
  storm: 14,
  vault: 15,
  post: 16,
  expost: 17,
  plinth: 18,
  grate: 19,
  kpost: 20,
  // Стены (лицо стены).
  window: 30,
  broken: 31,
  banner: 32,
  chains: 33,
  arch: 34,
  skulls: 35,
  sconce: 36,
  fount: 37,
  bars: 38,
  // Клетки, сменённые на ходу (`setTile`).
  fallen: 40,
  cracking: 41,
} as const;

/** Районы этажа. `f10` — вход: на нём могут стоять сохранения. */
export const F10_GATES = 'f10';
export const F10_GALLERY = 'f10gallery';
export const F10_THRONE = 'f10throne';

const M = F10_MARK;

/** Свои буквы карты — одни на все три района. */
const LEGEND: Record<string, LegendCell> = {
  r: { tile: 'floor', mark: M.carpet },
  m: { tile: 'floor', mark: M.marble },
  k: { tile: 'floor', mark: M.bones },
  x: { tile: 'floor', mark: M.blood },
  z: { tile: 'floor', mark: M.soot },
  q: { tile: 'floor', mark: M.crack },
  h: { tile: 'floor', mark: M.bridge },
  // Пропасть: не пройти, но видно через неё, летуны над ней висят.
  _: { tile: 'deep', mark: M.abyss },
  '^': { tile: 'floor', mark: M.spike },
  s: { tile: 'floor', mark: M.straw },
  g: { tile: 'floor', mark: M.glass },
  d: { tile: 'floor', mark: M.dais },
  j: { tile: 'floor', mark: M.rune, light: { r: 1.6, tint: 'violet' } },
  '4': { tile: 'floor', mark: M.storm },
  '6': { tile: 'floor', mark: M.vault },
  // Посты: пол, на котором ждёт страж / палач / рыцарь (ставит сценарий).
  '1': { tile: 'floor', mark: M.post },
  '3': { tile: 'floor', mark: M.expost },
  '5': { tile: 'floor', mark: M.kpost },
  // Постамент живой горгульи: сама горгулья — монстр, её ставит сценарий.
  '2': { tile: 'floor', mark: M.plinth, obj: { kind: 'deco', ref: 'f10_plinth', solid: 0 } },
  // Решётка над жаром: пол, под ним тлеет.
  e: { tile: 'floor', mark: M.grate, light: { r: 2.2, tint: 'red' } },
  // Настенное.
  w: {
    tile: 'wall',
    mark: M.window,
    obj: { kind: 'deco', ref: 'f10_window', solid: 0 },
    light: { r: 2.6, tint: 'violet' },
  },
  n: { tile: 'wall', mark: M.banner, obj: { kind: 'deco', ref: 'f10_banner', solid: 0 } },
  J: { tile: 'wall', mark: M.chains, obj: { kind: 'deco', ref: 'f10_chains', solid: 0 } },
  H: { tile: 'wall', mark: M.arch },
  Q: { tile: 'wall', mark: M.skulls },
  t: {
    tile: 'wall',
    mark: M.sconce,
    obj: { kind: 'deco', ref: 'f10_sconce', solid: 0 },
    light: { r: 4.4, tint: 'warm' },
  },
  F: {
    tile: 'wall',
    mark: M.fount,
    obj: { kind: 'deco', ref: 'f10_wallfont', solid: 0 },
    light: { r: 1.8, tint: 'red' },
  },
  f: { tile: 'floor', obj: { kind: 'deco', ref: 'f10_basin', solid: 0.34 } },
  // Предметы на полу.
  i: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f10_brazier', solid: 0.32 },
    light: { r: 4.6, tint: 'warm' },
  },
  y: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f10_candles', solid: 0.22 },
    light: { r: 3.2, tint: 'warm' },
  },
  O: { tile: 'floor', obj: { kind: 'deco', ref: 'f10_column', solid: 0.46 } },
  U: { tile: 'floor', obj: { kind: 'breakable', ref: 'f10_urn', solid: 0.3, hp: 1 } },
  V: { tile: 'floor', obj: { kind: 'breakable', ref: 'f10_coffer', solid: 0.38, hp: 2 } },
  Z: { tile: 'floor', obj: { kind: 'deco', ref: 'f10_skulls', solid: 0.55 } },
  W: { tile: 'floor', obj: { kind: 'deco', ref: 'f10_gargstatue', solid: 0.55 } },
  A: { tile: 'floor', obj: { kind: 'deco', ref: 'f10_devil', solid: 0.6 } },
  N: { tile: 'floor', obj: { kind: 'deco', ref: 'f10_lord', solid: 0.6 } },
  I: { tile: 'floor', obj: { kind: 'deco', ref: 'f10_iron', solid: 0.55 } },
  '&': { tile: 'floor', obj: { kind: 'deco', ref: 'f10_polearm', solid: 0.5 } },
  '8': {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f10_bloodfont', solid: 0.62 },
    light: { r: 2.4, tint: 'red' },
  },
  '7': {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f10_flamealtar', solid: 0.55 },
    light: { r: 4.2, tint: 'red' },
  },
  p: { tile: 'floor', obj: { kind: 'deco', ref: 'f10_pike', solid: 0.16 } },
  '+': { tile: 'floor', mark: M.bones, obj: { kind: 'deco', ref: 'f10_heroes', solid: 0.3 } },
  '*': { tile: 'floor', obj: { kind: 'deco', ref: 'f10_cage', solid: 0.36 } },
  '0': { tile: 'floor', mark: M.straw, obj: { kind: 'deco', ref: 'f10_post', solid: 0.22 } },
  // Трон: под K, за спиной короля; пока он сидит — насквозь.
  u: { tile: 'floor', mark: M.dais, obj: { kind: 'deco', ref: 'f10_throne', solid: 0 } },
};

const GORE_DEMON = ['#2a1416', '#8a1c22', '#e0402e', '#1a0c0e'];

const MOBS: MobDef[] = [
  {
    id: 'f10_hound',
    name: 'Адский пёс',
    many: 'адских псов',
    hp: 22,
    dmg: 13,
    speed: 4.6,
    radius: 0.3,
    windup: 0.4,
    reach: 0.42,
    rest: 0.8,
    xp: 8,
    meat: ['f10_hellmeat', 0.5, 1],
    mats: [['f10mat', 0.12]],
    beast: true,
    brain: 'f10_hound',
    art: { kind: 'paint', id: 'f10_hound' },
    mass: 1.3,
    flinch: 0.35,
    eye: '#ffb030',
    light: 1,
    gore: ['#1c1416', '#ff7a2a', '#5a2c24', '#ffd060'],
  },
  {
    id: 'f10_guard',
    name: 'Демон-страж',
    many: 'демонов-стражей',
    hp: 50,
    dmg: 18,
    speed: 2.5,
    radius: 0.42,
    windup: 0.8,
    reach: 1.1,
    rest: 1.1,
    xp: 16,
    meat: ['f10_heart', 0.08, 1],
    mats: [['f10mat', 0.35]],
    beast: true,
    brain: 'f10_guard',
    art: { kind: 'paint', id: 'f10_guard' },
    mass: 3.5,
    flinch: 0.12,
    stunT: 0.25,
    eye: '#ff4a20',
    gore: GORE_DEMON,
  },
  {
    id: 'f10_knight',
    name: 'Рыцарь ада',
    many: 'рыцарей ада',
    hp: 44,
    dmg: 20,
    speed: 3,
    radius: 0.55,
    windup: 0.9,
    reach: 0.6,
    rest: 1.2,
    xp: 18,
    meat: null,
    mats: [
      ['f10_shoe', 0.4],
      ['f10mat', 0.2],
    ],
    beast: true,
    brain: 'f10_knight',
    art: { kind: 'paint', id: 'f10_knight' },
    mass: 6,
    flinch: 0.05,
    stunT: 0.3,
    eye: '#ff6a20',
    light: 1.4,
    gore: ['#1a1418', '#ff6a20', '#3a3440', '#8a1c22'],
  },
  {
    id: 'f10_succubus',
    name: 'Суккуба',
    many: 'суккуб',
    hp: 26,
    dmg: 14,
    speed: 3.5,
    radius: 0.3,
    windup: 0.6,
    reach: 0.45,
    rest: 0.9,
    xp: 12,
    meat: null,
    mats: [
      ['f10_silk', 0.3],
      ['f10mat', 0.08],
    ],
    beast: true,
    brain: 'f10_succubus',
    art: { kind: 'paint', id: 'f10_succubus' },
    mass: 0.9,
    flinch: 0.45,
    fly: true,
    eye: '#ff70d0',
    gore: ['#3a1428', '#e05aa0', '#1a0c16', '#ffb0e0'],
  },
  {
    id: 'f10_gargoyle',
    name: 'Горгулья',
    many: 'горгулий',
    hp: 58,
    dmg: 20,
    speed: 3.1,
    radius: 0.55,
    windup: 0.6,
    reach: 0.55,
    rest: 1,
    xp: 18,
    meat: null,
    mats: [
      ['f10_claw', 0.45],
      ['f10mat', 0.15],
    ],
    beast: true,
    brain: 'f10_gargoyle',
    art: { kind: 'paint', id: 'f10_gargoyle' },
    mass: 6,
    flinch: 0.08,
    stunT: 0.3,
    noAlbino: true,
    eye: '#ff2a2a',
    gore: ['#5a5058', '#8a8088', '#2a2428', '#c0b8b8'],
  },
  {
    id: 'f10_mage',
    name: 'Архидемон-маг',
    many: 'архидемонов-магов',
    hp: 32,
    dmg: 16,
    speed: 2.6,
    radius: 0.34,
    windup: 1,
    reach: 5.5,
    rest: 1.5,
    xp: 16,
    meat: null,
    mats: [
      ['f10_sigil', 0.35],
      ['f10mat', 0.1],
    ],
    beast: true,
    brain: 'f10_mage',
    art: { kind: 'paint', id: 'f10_mage' },
    mass: 1.4,
    flinch: 0.5,
    eye: '#c890ff',
    light: 1.8,
    gore: ['#2a1a3a', '#9a6aff', '#8a1c22', '#f0e0ff'],
  },
  {
    id: 'f10_exec',
    name: 'Палач',
    many: 'палачей',
    hp: 64,
    dmg: 22,
    speed: 2.2,
    radius: 0.5,
    windup: 1,
    reach: 0.6,
    rest: 1.3,
    xp: 22,
    meat: ['f10_heart', 0.25, 1],
    mats: [['f10mat', 0.5]],
    beast: true,
    brain: 'f10_exec',
    art: { kind: 'paint', id: 'f10_exec' },
    mass: 6,
    flinch: 0.05,
    stunT: 0.3,
    eye: '#ff3020',
    gore: GORE_DEMON,
  },
  {
    id: 'f10_imp',
    name: 'Имп-носильщик',
    many: 'импов-носильщиков',
    hp: 20,
    dmg: 6,
    speed: 5.4,
    radius: 0.26,
    windup: 0.4,
    reach: 0.3,
    rest: 1,
    xp: 30,
    meat: null,
    mats: [['f10mat', 0.6]],
    beast: true,
    brain: 'f10_imp',
    art: { kind: 'paint', id: 'f10_imp' },
    mass: 0.8,
    flinch: 1,
    coins: 1600,
    resume: 'flee',
    eye: '#ffd040',
    light: 1.4,
    gore: ['#8a1c22', '#ffd040', '#2a1416', '#e04030'],
  },
  {
    id: 'f10boss',
    name: 'Король демонов',
    many: 'королей демонов',
    hp: 920,
    dmg: 20,
    speed: 2.4,
    radius: 1,
    windup: 0.9,
    reach: 1,
    rest: 0.9,
    xp: 900,
    meat: null,
    mats: [],
    beast: true,
    brain: 'f10boss',
    art: { kind: 'paint', id: 'f10boss' },
    mass: 14,
    boss: true,
    noAlbino: true,
    eye: '#ff2020',
    light: 3,
    gore: ['#1a1418', '#8a1c22', '#ffd060', '#e0402e'],
  },
];

/** Врата: псы стаями, стража, суккубы и маги из проломов. */
const spawnGates: SpawnSpec = {
  mobs: [
    ['f10_hound', 50],
    ['f10_guard', 24],
    ['f10_succubus', 14],
    ['f10_mage', 12],
  ],
  density: 0.72,
  pack: [1, 2],
  filler: 'f10_hound',
  // Спящая стая — псы, пятым — страж-псарь.
  group: (i) => (i < 4 ? 'f10_hound' : 'f10_guard'),
  horde: null,
  treasure: 'f10_imp',
  nest: () => 'f10_hound',
};

const spawnGallery: SpawnSpec = {
  ...spawnGates,
  mobs: [
    ['f10_succubus', 30],
    ['f10_mage', 24],
    ['f10_hound', 26],
    ['f10_guard', 20],
  ],
  density: 0.76,
  group: (i) => (i < 2 ? 'f10_succubus' : 'f10_hound'),
};

const spawnThrone: SpawnSpec = {
  ...spawnGates,
  mobs: [
    ['f10_guard', 40],
    ['f10_hound', 26],
    ['f10_mage', 20],
    ['f10_succubus', 14],
  ],
  density: 0.8,
  pack: [1, 2],
  filler: 'f10_hound',
  group: (i) => (i < 2 ? 'f10_guard' : 'f10_hound'),
};

export const F10: FloorDef = {
  id: 10,
  name: 'Трон демона',
  lead: 'Замок под лагерем: Врата, витражи и трон. Здесь заканчиваются все спуски.',
  mapVer: 1,
  areas: [
    {
      id: F10_GATES,
      name: 'Врата преисподней',
      lead: 'Кости героев у ворот. Дальше — мост над бездной.',
      tier: 8,
      level: 9,
      ambient: 0.42,
      rows: MAP_F10_GATES,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.66, 0.54, 0.56], mix: '#3a0a0e', k: 0.12 },
        fog: '#0a0204',
      },
      legend: LEGEND,
      mine: 'f10mine',
      spawn: spawnGates,
    },
    {
      id: F10_GALLERY,
      name: 'Галерея витражей',
      lead: 'Молнии за стёклами. Статуи смотрят тебе вслед.',
      tier: 8,
      level: 9,
      ambient: 0.46,
      rows: MAP_F10_GALLERY,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.6, 0.56, 0.7], mix: '#1a0e2a', k: 0.1 },
        fog: '#07040c',
      },
      legend: LEGEND,
      spawn: spawnGallery,
    },
    {
      id: F10_THRONE,
      name: 'Тронный зал',
      lead: 'Путь процессий. В конце — трон и тот, кто на нём.',
      tier: 8,
      level: 9,
      ambient: 0.5,
      rows: MAP_F10_THRONE,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.62, 0.5, 0.52], mix: '#2a0608', k: 0.14 },
        fog: '#0c0203',
      },
      legend: LEGEND,
      mine: 'f10mine2',
      spawn: spawnThrone,
    },
  ],
  boss: {
    id: 'f10boss',
    name: 'Король демонов',
    lead: 'Тронный зал в конце Пути процессий',
    area: F10_THRONE,
    restMs: 20 * 60_000,
    mob: 'f10boss',
    script: 'f10boss',
    parts: ['f10boss'],
    loot: (rnd) => ({
      tokens: 70 + Math.floor(rnd() * 40),
      keys: rnd() < 0.8 ? 1 : 0,
      coins: 60_000,
      mats: {
        f10_crown: 1,
        f10mat: 4 + Math.floor(rnd() * 4),
        f10_sigil: 2 + Math.floor(rnd() * 2),
      },
    }),
  },
  mines: [
    {
      id: 'f10mine',
      name: 'Шахта у Двора казней',
      area: F10_GATES,
      windowMs: 60 * 60_000,
      ores: [18, 19],
      share: [0.24, 0.3, 0.38, 0.46, 0.55],
      pyrite: 0,
      blocks: 2.4,
    },
    {
      id: 'f10mine2',
      name: 'Шахта под троном',
      area: F10_THRONE,
      windowMs: 3 * 60 * 60_000,
      ores: [18, 19],
      share: [0.3, 0.38, 0.46, 0.54, 0.62],
      pyrite: 0,
      blocks: 3,
    },
  ],
  mobs: MOBS,
  meats: [
    { id: 'f10_hellmeat', name: 'Мясо адского пса', price: 60, heal: 0.3 },
    { id: 'f10_heart', name: 'Сердце демона', price: 110, heal: 0.45 },
  ],
  mats: [
    {
      id: 'f10mat',
      name: 'Адский обсидиан',
      price: 480,
      lead: 'Чёрное стекло из кладки замка. Режет — на оковку и рукояти.',
    },
    {
      id: 'f10_claw',
      name: 'Коготь горгульи',
      price: 620,
      lead: 'Каменный, но острый. Живым был ещё минуту назад.',
    },
    {
      id: 'f10_shoe',
      name: 'Подкова адского коня',
      price: 700,
      lead: 'Тёплая. Под ней до сих пор тлеет искра.',
    },
    {
      id: 'f10_silk',
      name: 'Шёлк суккубы',
      price: 560,
      lead: 'Лёгкий, как дым. Пахнет так, что забываешь, куда шёл.',
    },
    {
      id: 'f10_sigil',
      name: 'Печать архидемона',
      price: 800,
      lead: 'Кольцо с руной молнии. Щиплет пальцы.',
    },
    {
      id: 'f10_crown',
      name: 'Корона Короля демонов',
      price: 60_000,
      lead: 'Трофей. Рогатая, чёрная, с красным камнем. Трон пуст.',
      stack: 1,
    },
  ],
  music: { explore: 'depths', boss: 'boss' },
  cover: '/ui/areas/f10.png',
};
