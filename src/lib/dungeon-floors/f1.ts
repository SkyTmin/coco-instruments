// Этаж 1 — «Крысиные норы» (v2.81). Мотив — норы из Goblin Slayer: тёмные
// хитрые норы, мелкие твари стаей, ловушки на тропах, засады и шаман за
// спинами, — и зал босса первого этажа SAO: длинный тронный зал, у босса
// несколько полос здоровья, стража в латах выходит на фазах, на последней
// полосе он меняет оружие. Названия и картинки — свои.
//
// Районы (снизу вверх): Вход в шахты (уровень 0, первый комплект) и
// Прогрызенные штреки (уровень 1, второй комплект) с Тронным залом короля.
// id районов, крыс, короля, мяса, шкурок, пирита и шахт — прежние: на них
// стоят сохранения игроков и условия перековки снаряжения (`dungeon.ts`).
// Новое — с приставкой `f1`.
//
// ИИ и сценарий короля — `f1-brains.ts`, правила этажа (капканы,
// растяжки, Зал черепов, чары шамана) — там же, `registerFloor(1)`.
// Рисунок — `f1-art.ts`. Карта — `scripts/dungeon/f1.py` → `f1-map.ts`.

import type { MobDef } from '../dungeon';
import { MAP_HAUL, MAP_MOUTH } from './f1-map';
import type { FloorDef, LegendCell } from './types';

/** Король платит постоянно: 8 000 монет, корона, шкурки, лом и обереги. */
const KING_COINS = 8_000;

/** Марки своих клеток: их различает рисовальщик района (`f1-art.ts`). */
export const F1_MARK = {
  bones: 1,
  filth: 2,
  straw: 3,
  scratch: 4,
  /**
   * Пол под предметом этажа (факел, тотем, ловушка, хлам). Сам по себе не
   * рисуется: в пещере Входа рисовальщик кладёт под предмет грунт, иначе
   * движок, глядя на соседей-кости, стелил под тотемом плиты.
   */
  bare: 7,
  /** Сердце Зала черепов: встал сюда — зал захлопывается. */
  heart: 20,
  /** Устье зала: при засаде его заваливает. */
  mouth: 21,
  /** Пол круга черепов. */
  ring: 22,
  /** Черта круга. */
  ringLine: 23,
  /** Ковёр от ворот к трону. */
  carpet: 5,
  /** Знамя на стене тронного зала. */
  banner: 6,
} as const;

/**
 * Свои буквы карты. Ловушки — предметы на полу без тела (`solid: 0`):
 * через них ходят, а срабатывают они правилами этажа (`f1-brains.ts`).
 */
export const LEGEND: Record<string, LegendCell> = {
  q: { tile: 'floor', mark: F1_MARK.bare, obj: { kind: 'deco', ref: 'f1_trap', solid: 0 } },
  w: { tile: 'floor', mark: F1_MARK.bare, obj: { kind: 'deco', ref: 'f1_wire', solid: 0 } },
  j: { tile: 'floor', mark: F1_MARK.bare, obj: { kind: 'deco', ref: 'f1_rattle', solid: 0 } },
  k: { tile: 'floor', mark: F1_MARK.bones },
  f: { tile: 'hazard', mark: F1_MARK.filth, hazard: { slow: 0.55 } },
  h: { tile: 'floor', mark: F1_MARK.straw },
  Z: { tile: 'wall', mark: F1_MARK.scratch },
  t: {
    tile: 'floor',
    mark: F1_MARK.bare,
    obj: { kind: 'deco', ref: 'f1_torch', solid: 0.2, light: { r: 4.4, tint: 'warm' } },
  },
  H: {
    tile: 'floor',
    mark: F1_MARK.bare,
    obj: { kind: 'deco', ref: 'f1_totem', solid: 0.26, light: { r: 2.6, tint: 'green' } },
  },
  A: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f1_throne', solid: 0.72, light: { r: 3, tint: 'red' } },
  },
  g: {
    tile: 'floor',
    mark: F1_MARK.bare,
    obj: { kind: 'breakable', ref: 'f1_junk', solid: 0.36, hp: 2 },
  },
  Q: { tile: 'floor', mark: F1_MARK.heart },
  U: { tile: 'floor', mark: F1_MARK.mouth },
  x: { tile: 'floor', mark: F1_MARK.ring },
  y: { tile: 'floor', mark: F1_MARK.ringLine },
  r: { tile: 'floor', mark: F1_MARK.carpet },
  V: { tile: 'wall', mark: F1_MARK.banner },
};

const MOBS: MobDef[] = [
  {
    id: 'rat',
    name: 'Серая крыса',
    many: 'серых крыс',
    hp: 14,
    dmg: 9,
    speed: 3.7,
    radius: 0.26,
    windup: 0.26,
    reach: 0.34,
    rest: 0.55,
    xp: 3,
    meat: ['meat', 0.7, 1],
    mats: [['skin', 0.22]],
    beast: true,
    brain: 'melee',
    art: { kind: 'paint', id: 'f1_rat' },
    mass: 1,
    flinch: 0.35,
    zigzag: true,
  },
  {
    id: 'fatrat',
    name: 'Жирная крыса',
    many: 'жирных крыс',
    hp: 46,
    dmg: 18,
    speed: 2.1,
    radius: 0.36,
    windup: 0.5,
    reach: 0.42,
    rest: 1,
    xp: 9,
    meat: ['fatmeat', 1, 2],
    mats: [['skin', 0.6]],
    beast: true,
    brain: 'melee',
    art: { kind: 'paint', id: 'f1_rat' },
    mass: 2.6,
    flinch: 0,
    stunT: 0.14,
    hit: { push: 5 },
  },
  {
    id: 'bomber',
    name: 'Крыса-подрывник',
    many: 'подрывников',
    hp: 16,
    dmg: 30,
    speed: 3.2,
    radius: 0.26,
    windup: 1.5,
    reach: 1.4,
    rest: 2,
    xp: 7,
    meat: ['meat', 0.6, 1],
    mats: [
      ['tail', 0.5],
      ['skin', 0.2],
    ],
    beast: true,
    brain: 'bomber',
    art: { kind: 'paint', id: 'f1_rat' },
    mass: 1,
    flinch: 1,
  },
  {
    id: 'goldrat',
    name: 'Золотая крыса',
    many: 'золотых крыс',
    hp: 40,
    dmg: 0,
    speed: 5.2,
    radius: 0.27,
    windup: 0,
    reach: 0,
    rest: 0,
    xp: 25,
    meat: null,
    mats: [['skin', 1]],
    beast: true,
    brain: 'flee',
    art: { kind: 'paint', id: 'f1_rat' },
    mass: 1,
    flinch: 1,
    noAlbino: true,
    coins: 1_500,
    eye: '#fff0a0',
    gore: ['#d8a83a', '#fff0a8', '#8a6418'],
    resume: 'flee',
  },
  // --- Крысолюды: стоят на двух ногах, носят тряпьё и оружие из мусора. ---
  {
    // Ближний бой с финтом: обходит, делает ложный замах, потом выпад.
    id: 'f1_ratman',
    name: 'Крысолюд с заточкой',
    many: 'крысолюдов',
    hp: 30,
    dmg: 12,
    speed: 3.4,
    radius: 0.3,
    windup: 0.36,
    reach: 0.4,
    rest: 0.8,
    xp: 6,
    meat: ['meat', 0.6, 1],
    mats: [
      ['f1_shiv', 0.18],
      ['skin', 0.25],
    ],
    beast: true,
    brain: 'f1_ratman',
    art: { kind: 'paint', id: 'f1_ratman' },
    mass: 1.5,
    flinch: 0.25,
    stunT: 0.25,
    eye: '#ff6a2e',
    gore: ['#6b5a4a', '#8a7462', '#3d3630', '#b8584a'],
  },
  {
    // Камень навесом: держит дистанцию, прячется за своими.
    id: 'f1_slinger',
    name: 'Пращник',
    many: 'пращников',
    hp: 20,
    dmg: 13,
    speed: 3.1,
    radius: 0.28,
    windup: 0.8,
    reach: 0.4,
    rest: 1.7,
    xp: 7,
    meat: ['meat', 0.5, 1],
    mats: [
      ['f1_strap', 0.22],
      ['skin', 0.2],
    ],
    beast: true,
    brain: 'f1_slinger',
    art: { kind: 'paint', id: 'f1_slinger' },
    mass: 1.1,
    flinch: 0.6,
    eye: '#ff6a2e',
    shot: { speed: 7, r: 0.55, life: 2.5, dmg: 1, art: 'f1_stone', lob: true },
    gore: ['#6b5a4a', '#8a7462', '#3d3630', '#b8584a'],
  },
  {
    // Не бьёт сам: лечит, ускоряет и бодрит стаю вокруг. Убей первым.
    id: 'f1_shaman',
    name: 'Крысиный шаман',
    many: 'шаманов',
    hp: 26,
    dmg: 6,
    speed: 2.8,
    radius: 0.3,
    windup: 0.9,
    reach: 0.4,
    rest: 3.2,
    xp: 14,
    meat: ['meat', 0.5, 1],
    mats: [
      ['f1_charm', 0.45],
      ['skin', 0.3],
    ],
    beast: true,
    brain: 'f1_shaman',
    art: { kind: 'paint', id: 'f1_shaman' },
    mass: 1,
    flinch: 1,
    stunT: 0.5,
    light: 1.4,
    eye: '#9dff6a',
    gore: ['#6b6a52', '#9aa070', '#3d3a30', '#8cff6a'],
  },
  {
    // Латы из кастрюль и обрезков рельса: спереди удар звенит, бей со спины.
    id: 'f1_guard',
    name: 'Латник из мусора',
    many: 'латников',
    hp: 90,
    dmg: 19,
    speed: 1.9,
    radius: 0.42,
    windup: 0.6,
    reach: 0.55,
    rest: 1.1,
    xp: 22,
    meat: ['fatmeat', 0.6, 1],
    mats: [
      ['f1_scrap', 0.6],
      ['skin', 0.3],
    ],
    beast: true,
    brain: 'f1_guard',
    art: { kind: 'paint', id: 'f1_guard' },
    mass: 3.5,
    flinch: 0,
    stunT: 0.9,
    hit: { push: 6 },
    eye: '#ffa030',
    gore: ['#8a7a68', '#b8a890', '#4a3a30', '#c8702a'],
  },
  // --- Король и малые короли. Корона падает ОДНА — из сундука босса. ---
  {
    id: 'king',
    name: 'Крысиный король',
    many: 'крысиных королей',
    hp: 2300,
    dmg: 16,
    speed: 2.5,
    radius: 0.95,
    windup: 0.8,
    reach: 0.6,
    rest: 1.2,
    xp: 450,
    meat: ['fatmeat', 1, 12],
    mats: [],
    beast: true,
    brain: 'king',
    art: { kind: 'paint', id: 'f1_king' },
    mass: 9,
    boss: true,
    noAlbino: true,
    eye: '#ffcc30',
  },
  {
    id: 'kinglet',
    name: 'Малый король',
    many: 'малых королей',
    hp: 260,
    dmg: 14,
    speed: 3.3,
    radius: 0.5,
    windup: 0.6,
    reach: 0.4,
    rest: 1,
    xp: 60,
    meat: ['fatmeat', 1, 3],
    mats: [['skin', 1]],
    beast: false,
    brain: 'king',
    art: { kind: 'paint', id: 'f1_king' },
    mass: 4,
    boss: true,
    noAlbino: true,
    eye: '#ffcc30',
  },
];

export const F1: FloorDef = {
  id: 1,
  name: 'Крысиные норы',
  lead: 'Норы под лагерем: крысы, крысолюды, ловушки и Тронный зал короля.',
  mapVer: 3,
  // Снизу вверх: вход с лифтом, выше — штреки и тронный зал.
  areas: [
    {
      id: 'mouth',
      name: 'Вход в шахты',
      lead: 'Старые выработки у лифта. Крысы и первые ловушки — смотри под ноги.',
      tier: 1,
      level: 0,
      ambient: 0.56,
      rows: MAP_MOUTH,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [1, 0.96, 0.9], mix: '#2a1a10', k: 0.05 },
        fog: '#07060a',
      },
      legend: LEGEND,
      mine: 'pyrite1',
      spawn: {
        mobs: [
          ['rat', 74],
          ['fatrat', 12],
          ['bomber', 5],
          ['f1_ratman', 6],
          ['f1_slinger', 3],
        ],
        density: 1,
        pack: [2, 2],
        filler: 'rat',
        group: (i, _n, rnd) => {
          if (i !== 0) return 'rat';
          const r = rnd();
          return r < 0.25 ? 'bomber' : r < 0.55 ? 'f1_ratman' : 'rat';
        },
        horde: (rnd) => (rnd() < 0.85 ? 'rat' : 'fatrat'),
        treasure: 'goldrat',
        nest: (cart, rnd) => (cart && rnd() < 0.3 ? 'fatrat' : 'rat'),
      },
    },
    {
      id: 'haul',
      name: 'Прогрызенные штреки',
      lead: 'Норы крысолюдов: капканы на тропах, шаманы за спинами, логово короля.',
      tier: 2,
      level: 1,
      ambient: 0.42,
      rows: MAP_HAUL,
      skin: {
        floor: 'ground',
        wall: 'rock',
        tint: { mul: [0.9, 0.94, 0.84], mix: '#18200e', k: 0.08 },
        fog: '#050706',
      },
      legend: LEGEND,
      mine: 'pyrite2',
      spawn: {
        mobs: [
          ['rat', 40],
          ['fatrat', 16],
          ['bomber', 11],
          ['f1_ratman', 17],
          ['f1_slinger', 9],
          ['f1_shaman', 5],
          ['f1_guard', 2],
        ],
        density: 1.1,
        pack: [2, 3],
        filler: 'rat',
        group: (i, n, rnd) => {
          if (i === 0) return rnd() < 0.3 ? 'f1_shaman' : 'f1_ratman';
          if (i === n - 1 && rnd() < 0.5) return 'f1_slinger';
          return i % 2 === 0 ? 'fatrat' : 'rat';
        },
        horde: (rnd) => (rnd() < 0.85 ? 'rat' : 'fatrat'),
        treasure: 'goldrat',
        nest: (cart, rnd) => (cart && rnd() < 0.3 ? 'fatrat' : 'rat'),
        carts: true,
      },
    },
  ],
  boss: {
    id: 'king',
    name: 'Крысиный король',
    lead: 'Тронный зал в Прогрызенных штреках',
    area: 'haul',
    restMs: 20 * 60_000,
    mob: 'king',
    script: 'king',
    parts: ['king', 'kinglet'],
    loot: (rnd) => ({
      tokens: 20 + Math.floor(rnd() * 20),
      keys: rnd() < 0.4 ? 1 : 0,
      coins: KING_COINS,
      mats: {
        crown: 1,
        skin: 6 + Math.floor(rnd() * 6),
        f1_scrap: 2 + Math.floor(rnd() * 3),
        f1_charm: 1 + Math.floor(rnd() * 2),
      },
    }),
  },
  mines: [
    {
      id: 'pyrite1',
      name: 'Шахта у входа',
      area: 'mouth',
      windowMs: 60 * 60_000,
      ores: [0, 1],
      share: [0.14, 0.2, 0.26, 0.32, 0.4],
      pyrite: 0.5,
      blocks: 1.4,
    },
    {
      id: 'pyrite2',
      name: 'Глубокая шахта',
      area: 'haul',
      windowMs: 3 * 60 * 60_000,
      ores: [0, 1],
      share: [0.22, 0.3, 0.38, 0.46, 0.55],
      pyrite: 0.5,
      blocks: 2.2,
    },
  ],
  mobs: MOBS,
  meats: [
    { id: 'meat', name: 'Крысятина', price: 25, heal: 0.15 },
    { id: 'fatmeat', name: 'Жирная крысятина', price: 45, heal: 0.25 },
  ],
  mats: [
    { id: 'skin', name: 'Крысиная шкурка', price: 20, lead: 'На заточку снаряжения.' },
    { id: 'tail', name: 'Хвост подрывника', price: 35, lead: 'Фитиль в нём не догорел.' },
    {
      id: 'pyrite',
      name: 'Пирит',
      price: 70,
      lead: '«Кошачье золото» из подземных шахт — для каски и улучшений.',
    },
    {
      id: 'f1_shiv',
      name: 'Ржавая заточка',
      price: 45,
      lead: 'Крысолюд точил её о рельс. Пойдёт на клинки.',
    },
    {
      id: 'f1_strap',
      name: 'Ремень пращи',
      price: 40,
      lead: 'Сыромятная кожа, пропитанная жиром. Пойдёт на сапоги.',
    },
    {
      id: 'f1_charm',
      name: 'Костяной оберег',
      price: 90,
      lead: 'Шаман шептал над ним у тотема. Пойдёт на каски.',
    },
    {
      id: 'f1_scrap',
      name: 'Лом из лат',
      price: 60,
      lead: 'Кастрюли, заклёпки и обрезки рельса. Пойдёт на робы.',
    },
    {
      id: 'crown',
      name: 'Корона Крысиного короля',
      price: 6_000,
      lead: 'Трофей. Нужен, чтобы улучшить снаряжение до Кованого.',
      stack: 1,
    },
  ],
  music: { explore: 'depths', boss: 'boss' },
  cover: '/ui/areas/mouth.png',
};
