// Этаж 4 — «Двойная крипта» (v2.81). Мотив — двойное подземелье: снизу
// обычный склеп (лифт, галерея погребальных ниш, ротонда, развилка на
// оссуарий и зал стражи, зал прощаний), а за узким порогом — второй,
// настоящий зал. Колоннада со статуями, среди которых есть живые, и в её
// конце, за воротами, — огромный зал Каменного идола. Названия свои.
//
// Монстры (ИИ — `f4-brains.ts`, рисунок — `f4-art.ts`):
//   • Костяк — убитый рассыпается КУЧКОЙ КОСТЕЙ; не добил кучку за
//     `BONES_RISE` секунд — кости сползаются и он встаёт снова;
//   • Латник склепа — ростовой щит спереди: удар в лоб — искры и почти
//     без урона, со спины и сбоку — полный, тяжёлый удар выбивает щит;
//     медленно поворачивается, медленный выпад копьём, после выпада открыт;
//   • Некромант — держится сзади, стреляет могильным огнём (холод),
//     поднимает кучки костей и ставит новые, рядом — исчезает и
//     появляется поодаль. Убей первым;
//   • Страж-изваяние — статуя, которая движется, только пока на неё НЕ
//     смотрят; посмотрел — застыла, даже посреди замаха.
// Босс — Каменный идол: скрижаль заповедей, лучи из глаз с безопасными
// плитами, стражи по периметру (см. `f4-brains.ts`).

import type { MobDef } from '../dungeon';
import { MAP_F4_CRYPT, MAP_F4_SANCT } from './f4-map';
import type { FloorDef, LegendCell } from './types';

/** Номера своих клеток (марки легенды) — их различает рисовальщик района. */
export const F4_MARK = {
  bones: 1,
  grave: 2,
  carpet: 3,
  crack: 4,
  plinth: 10,
  dais: 11,
  plate: 12,
  niche: 20,
  coffin: 21,
  relief: 22,
} as const;

const M = F4_MARK;

/** Общие буквы обоих районов. */
const COMMON: Record<string, LegendCell> = {
  // Саркофаг — на две клетки: изголовье (q) и изножье (e).
  q: { tile: 'floor', obj: { kind: 'deco', ref: 'f4_sarcL', solid: 0.46 } },
  e: { tile: 'floor', obj: { kind: 'deco', ref: 'f4_sarcR', solid: 0.46 } },
  i: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f4_candle', solid: 0 },
    light: { r: 2.8, tint: 'warm' },
  },
  U: { tile: 'floor', obj: { kind: 'breakable', ref: 'f4_urn', solid: 0.3, hp: 1 } },
  O: { tile: 'floor', obj: { kind: 'deco', ref: 'f4_column', solid: 0.42 } },
  Z: { tile: 'floor', obj: { kind: 'deco', ref: 'f4_skulls', solid: 0.4 } },
  A: { tile: 'floor', obj: { kind: 'deco', ref: 'f4_rack', solid: 0.34 } },
  W: { tile: 'floor', obj: { kind: 'deco', ref: 'f4_coffin', solid: 0.4 } },
  k: { tile: 'floor', mark: M.bones },
  g: { tile: 'floor', mark: M.grave },
  r: { tile: 'floor', mark: M.carpet },
  x: { tile: 'floor', mark: M.crack },
  N: { tile: 'wall', mark: M.niche },
  H: { tile: 'wall', mark: M.coffin },
  w: { tile: 'wall', mark: M.relief },
};

const SANCT: Record<string, LegendCell> = {
  ...COMMON,
  F: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f4_brazier', solid: 0.32 },
    light: { r: 4.8, tint: 'warm' },
  },
  // Мёртвая статуя на постаменте — не двигается никогда. Выглядит ровно как
  // живой страж: в этом и страх колоннады.
  Q: { tile: 'floor', mark: M.plinth, obj: { kind: 'deco', ref: 'f4_statue', solid: 0.4 } },
  // Постамент живого стража: сам страж — моб, его ставит правило этажа.
  J: { tile: 'floor', mark: M.plinth, obj: { kind: 'deco', ref: 'f4_sped', solid: 0 } },
  // Постамент стража идола: до боя на нём статуя, в бою — пусто (страж сошёл).
  j: { tile: 'floor', mark: M.plinth, obj: { kind: 'deco', ref: 'f4_astat', solid: 0.42 } },
  I: { tile: 'floor', mark: M.dais, obj: { kind: 'deco', ref: 'f4_idol', solid: 1.25 } },
  h: { tile: 'floor', mark: M.dais },
  p: { tile: 'floor', mark: M.plate },
  z: {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f4_tablet', solid: 0.46 },
    light: { r: 2, tint: 'cold' },
  },
};

/** Сколько секунд кучка костей ждёт удара, прежде чем встать. */
export const BONES_RISE = 5;

const MOBS: MobDef[] = [
  {
    id: 'f4_skel',
    name: 'Костяк',
    many: 'костяков',
    hp: 24,
    dmg: 11,
    speed: 3.1,
    radius: 0.28,
    windup: 0.42,
    reach: 0.5,
    rest: 0.8,
    xp: 8,
    meat: null,
    mats: [['f4_bone', 0.2]],
    beast: true,
    brain: 'f4_skel',
    art: { kind: 'paint', id: 'f4_skel' },
    mass: 1,
    flinch: 0.4,
    eye: '#ff5a3a',
    gore: ['#d8d0bc', '#a89c86', '#6a6050'],
  },
  {
    id: 'f4_bones',
    name: 'Кучка костей',
    many: 'кучек костей',
    hp: 2.5,
    dmg: 0,
    speed: 0,
    radius: 0.26,
    windup: 0,
    reach: 0,
    rest: 0,
    xp: 3,
    meat: null,
    mats: [['f4_bone', 0.3]],
    beast: true,
    brain: 'f4_bones',
    art: { kind: 'paint', id: 'f4_bones' },
    mass: 0.6,
    flinch: 0,
    noAlbino: true,
    gore: ['#d8d0bc', '#a89c86', '#e8e2d4'],
  },
  {
    id: 'f4_knight',
    name: 'Латник склепа',
    many: 'латников',
    hp: 50,
    dmg: 15,
    speed: 1.7,
    radius: 0.36,
    windup: 0.75,
    reach: 1.7,
    rest: 1.2,
    xp: 16,
    meat: ['f4_ration', 0.18, 1],
    mats: [['f4_iron', 0.35]],
    beast: true,
    brain: 'f4_knight',
    art: { kind: 'paint', id: 'f4_knight' },
    mass: 3,
    flinch: 0,
    stunT: 0.3,
    eye: '#ffb040',
    gore: ['#8b8f94', '#4b4e53', '#c4c8cc'],
  },
  {
    id: 'f4_necro',
    name: 'Некромант',
    many: 'некромантов',
    hp: 30,
    dmg: 12,
    speed: 2.4,
    radius: 0.3,
    windup: 0.85,
    reach: 6,
    rest: 2.2,
    xp: 22,
    meat: null,
    mats: [
      ['f4_page', 0.4],
      ['f4_bone', 0.2],
    ],
    beast: true,
    brain: 'f4_necro',
    art: { kind: 'paint', id: 'f4_necro' },
    mass: 1,
    flinch: 1,
    eye: '#8aff7a',
    light: 1.6,
    gore: ['#3a2a44', '#8aff7a', '#1e1624'],
    shot: {
      speed: 5.2,
      r: 0.3,
      life: 2.4,
      dmg: 1,
      art: 'f4_gravefire',
      status: 'chill',
      dur: 1.6,
    },
  },
  {
    id: 'f4_sentry',
    name: 'Страж-изваяние',
    many: 'стражей-изваяний',
    hp: 55,
    dmg: 14,
    speed: 2.7,
    radius: 0.36,
    windup: 0.55,
    reach: 0.55,
    rest: 0.9,
    xp: 24,
    meat: null,
    mats: [['f4_shard', 0.35]],
    beast: true,
    brain: 'f4_sentry',
    art: { kind: 'paint', id: 'f4_statue' },
    mass: 20,
    flinch: 0,
    stunT: 0.1,
    noAlbino: true,
    eye: '#ff3a28',
    gore: ['#7e8578', '#5a6056', '#a8ae9e'],
  },
  {
    id: 'f4_idol',
    name: 'Каменный идол',
    many: 'каменных идолов',
    hp: 850,
    dmg: 18,
    speed: 0,
    radius: 1.25,
    windup: 1,
    reach: 2,
    rest: 1,
    xp: 900,
    meat: null,
    mats: [],
    beast: true,
    brain: 'f4_idol',
    art: { kind: 'paint', id: 'f4_idol' },
    mass: 999,
    boss: true,
    noAlbino: true,
    eye: '#ffb040',
    light: 3,
    gore: ['#7e8578', '#5a6056', '#d8c070', '#a8ae9e'],
  },
  {
    id: 'f4_statue',
    name: 'Страж идола',
    many: 'стражей идола',
    hp: 70,
    dmg: 18,
    speed: 2.7,
    radius: 0.38,
    windup: 0.55,
    reach: 0.55,
    rest: 0.9,
    xp: 40,
    meat: null,
    // Осколки — в добыче идола: стражи собираются заново, и с них не фармить.
    mats: [],
    beast: false,
    brain: 'f4_statue',
    art: { kind: 'paint', id: 'f4_statue' },
    mass: 20,
    boss: true,
    noAlbino: true,
    eye: '#ff3a28',
    gore: ['#7e8578', '#5a6056', '#a8ae9e'],
  },
];

export const F4: FloorDef = {
  id: 4,
  name: 'Двойная крипта',
  lead: 'Обычный склеп… а за ним второй, настоящий зал. Каменный идол на троне и статуи, которые не любят, когда на них не смотрят.',
  mapVer: 1,
  areas: [
    {
      id: 'f4crypt',
      name: 'Крипта',
      lead: 'Склепы и ниши с костями. Кости здесь встают, если их не добить.',
      tier: 7,
      level: 6,
      ambient: 0.46,
      rows: MAP_F4_CRYPT,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.8, 0.92, 0.88], mix: '#1a2c26', k: 0.14 },
        fog: '#0a100e',
      },
      legend: COMMON,
      mine: 'f4mine',
      spawn: {
        mobs: [
          ['f4_skel', 62],
          ['f4_knight', 22],
          ['f4_necro', 16],
        ],
        density: 0.9,
        pack: [1, 2],
        filler: 'f4_skel',
        // Спящая стая — кости на полу; первым бывает некромант.
        group: (i, _n, rnd) =>
          i === 0 && rnd() < 0.35 ? 'f4_necro' : i === 1 && rnd() < 0.3 ? 'f4_knight' : 'f4_skel',
        horde: null,
        treasure: null,
        nest: () => 'f4_skel',
      },
    },
    {
      id: 'f4sanct',
      name: 'Святилище',
      lead: 'Второй зал. Статуи смотрят. Не отворачивайся от них надолго.',
      tier: 8,
      level: 7,
      ambient: 0.36,
      rows: MAP_F4_SANCT,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.76, 0.82, 0.94], mix: '#121a2a', k: 0.18 },
        fog: '#06080e',
      },
      legend: SANCT,
      mine: 'f4mine2',
      spawn: {
        mobs: [
          ['f4_knight', 40],
          ['f4_skel', 42],
          ['f4_necro', 18],
        ],
        density: 0.75,
        pack: [1, 2],
        filler: 'f4_skel',
        group: (i) => (i === 0 ? 'f4_knight' : 'f4_skel'),
        horde: null,
        treasure: null,
        nest: () => 'f4_skel',
      },
    },
  ],
  boss: {
    id: 'f4_idol',
    name: 'Каменный идол',
    lead: 'Трон в конце святилища',
    area: 'f4sanct',
    restMs: 20 * 60_000,
    mob: 'f4_idol',
    script: 'f4_idol',
    parts: ['f4_idol', 'f4_statue'],
    loot: (rnd) => ({
      tokens: 32 + Math.floor(rnd() * 24),
      keys: rnd() < 0.5 ? 1 : 0,
      coins: 32_000,
      mats: {
        f4_eye: 1,
        f4_shard: 4 + Math.floor(rnd() * 4),
        f4_bone: 3 + Math.floor(rnd() * 3),
      },
    }),
  },
  mines: [
    {
      id: 'f4mine',
      name: 'Железная штольня',
      area: 'f4crypt',
      windowMs: 60 * 60_000,
      ores: [6, 7],
      share: [0.2, 0.27, 0.34, 0.42, 0.5],
      pyrite: 0,
      blocks: 1.6,
    },
    {
      id: 'f4mine2',
      name: 'Кобальтовая жила',
      area: 'f4sanct',
      windowMs: 3 * 60 * 60_000,
      ores: [6, 7],
      share: [0.26, 0.34, 0.42, 0.5, 0.6],
      pyrite: 0,
      blocks: 2.2,
    },
  ],
  mobs: MOBS,
  // Еды в крипте мало: мертвецы не носят мяса, паёк — только у латников.
  meats: [{ id: 'f4_ration', name: 'Сухой паёк', price: 60, heal: 0.3 }],
  mats: [
    {
      id: 'f4_bone',
      name: 'Древняя кость',
      price: 55,
      lead: 'Кость, которая помнит, как стоять. На рукояти и древки.',
    },
    {
      id: 'f4_iron',
      name: 'Ржавая латная пластина',
      price: 85,
      lead: 'Снята с латника склепа. Перекуётся в броню.',
    },
    {
      id: 'f4_page',
      name: 'Страница гримуара',
      price: 130,
      lead: 'Некромант писал ею заклятия. Светится в темноте.',
    },
    {
      id: 'f4_shard',
      name: 'Осколок идола',
      price: 170,
      lead: 'Камень стража. Ещё тёплый, хотя статуи не дышат.',
    },
    {
      id: 'f4_eye',
      name: 'Око идола',
      price: 12_000,
      lead: 'Трофей. Глаз Каменного идола — погас, но смотрит.',
      stack: 1,
    },
  ],
  music: { explore: 'depths', boss: 'boss' },
  cover: '/ui/areas/f4crypt.png',
};
