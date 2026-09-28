// Этаж 7 — «Зеркальный лабиринт» (v2.81, второй заход). Мотив — подземелье
// с зеркальными двойниками: брошенный зеркальный дворец под землёй.
// Зеркала на стенах, стеклянные колонны, осколки на полу, холодный свет,
// лабиринт с обманками: часть «проходов» — отражения (стена, которая
// выглядит проходом), часть стен — наоборот, отражение, сквозь которое
// проходят; пустые рамы, из которых выходят тени; зеркала-переходы парами
// одного цвета. Названия свои.
//
// Районы снизу вверх: «Галерея отражений» (лифт), «Хрустальный лабиринт»,
// «Зал Двойника» (арена). Карта — `scripts/dungeon/f7.py` → `f7-map.ts`.
//
// Монстры (ИИ — `f7-brains.ts`, рисунок — `f7-art.ts`):
//   • Отражение — повторяет движения героя зеркально через невидимую
//     плоскость и с задержкой; копирует его удары (метка сразу, удар —
//     через миг). Выходит из зеркал;
//   • Стеклянный голем — броня трескается от ударов (чем больше трещин, тем
//     больнее ему), на каждой трещине осколки веером; умирая, лопается;
//   • Призрачная копия — есть, только пока на неё смотришь: отвернулся —
//     её не достать, и она заходит за спину; касание переворачивает мир
//     (очарован, джойстик наоборот);
//   • Тень из пустой рамы — засада: рама дрожит, из неё выходит тень и
//     тянет героя к раме; разбей раму — тень умрёт вместе с ней;
//   • Зеркальная бабочка — вспышка крыльями: круг на полу; кто СМОТРИТ на
//     неё в миг вспышки — ослеплён (холод); отвернулся — цел;
//   • Осколочный паук — натягивает стеклянные нити в узких проходах:
//     задел нить — режет и зовёт пауков; прыгает на героя по метке;
//   • Призма — бьёт лучом, который отражается от зеркал (метка ломаной);
//   • Стекольщик-воришка — редкий, с мешком монет: удирает сквозь зеркала.
// Босс — Отражение героя (`f7boss`): дуэль ударами героя, фаза теней
// (копии, настоящая — та, что отбрасывает тень), отражённый свет, разбитые
// зеркала арены.

import type { MobDef } from '../dungeon';
import { MAP_F7_CRYSTAL, MAP_F7_GALLERY, MAP_F7_HALL } from './f7-map';
import type { FloorDef, LegendCell, SpawnSpec } from './types';

/** Свои клетки этажа: номер вида для рисовальщиков и правил этажа. */
export const F7_MARK = {
  /** Зеркало на лице стены. */
  mirror: 1,
  /** Ложный проход: зеркало, в котором отражается коридор. */
  fake: 2,
  /** Треснувшее зеркало (разбили, ударились, бой). */
  cracked: 3,
  /** Мраморная шахматка галерей. */
  checker: 4,
  /** Ковровая дорожка. */
  carpet: 5,
  /** Осколки на полу: режут и вязнут. */
  shards: 6,
  /** Пропасть с отражениями (глубина). */
  void: 7,
  /** Стеклянный пол хрустального лабиринта. */
  glass: 8,
  /** Хрустальная стена. */
  crystal: 9,
  /** Мозаика арены. */
  mosaic: 10,
  /** Зеркало арены: бьётся в последней фазе. */
  arena: 11,
  /** Стена за большим зеркалом: открывается событием. */
  behind: 12,
  /** Иллюзия: пол, нарисованный зеркальной стеной. */
  illusion: 13,
  /** Шов хрусталя у выходов Зала призм. */
  seam: 14,
  /** Пол под предметом: узор берётся у соседей. */
  under: 15,
  /** Сколотая плита арены (последняя фаза). */
  scar: 16,
  /** Паркет ёлочкой: Зал портретов, Длинная галерея, коридор рам. */
  herring: 17,
  /** Полированный чёрный камень, в нём отражаются огни: Зал зеркала, тайники. */
  obsidian: 18,
  /** Шестигранные стеклянные плиты: Зал призм и притвор. */
  hex: 19,
  /** Стеклянный мосток над пропастью: сквозь него видно тьму. */
  bridge: 25,
  /** Сырой пол пещеры с ростками хрусталя: тупики и шахта лабиринта. */
  rough: 26,
  /** Дощатый пол мастерской стекольщика (кладовая с шахтой). */
  plank: 27,
  /** Пол зеркал-переходов: знак цвета пары (21…24). */
  portal: 20,
} as const;

/** Районы этажа. */
export const F7_GALLERY = 'f7';
export const F7_CRYSTAL = 'f7crystal';
export const F7_HALL = 'f7hall';

/** Цвета пар зеркал-переходов (номер пары → свет и краска рисовальщика). */
export const F7_PORTAL_TINT = ['cold', 'violet', 'teal', 'red'] as const;

const M = F7_MARK;

const prop = (
  kind: 'deco' | 'breakable',
  ref: string,
  solid: number,
  extra: Partial<LegendCell> & { hp?: number; loot?: string } = {},
): LegendCell => {
  const { hp, loot, ...rest } = extra;
  return {
    tile: 'floor',
    mark: M.under,
    obj: { kind, ref, solid, hp, loot },
    ...rest,
  };
};

/** Свои буквы карты: одни на все три района (узор пола под предметом — у соседей). */
const LEGEND: Record<string, LegendCell> = {
  m: { tile: 'wall', mark: M.mirror },
  // Зеркало с бликом: по стеклу раз в несколько секунд проходит свет.
  g: { tile: 'wall', mark: M.mirror, obj: { kind: 'deco', ref: 'f7_glint', solid: 0 } },
  f: { tile: 'wall', mark: M.fake },
  k: { tile: 'wall', mark: M.cracked },
  '?': { tile: 'floor', mark: M.illusion },
  '&': { tile: 'wall', mark: M.behind },
  w: { tile: 'wall', mark: M.crystal },
  A: { tile: 'wall', mark: M.arena },
  ':': { tile: 'floor', mark: M.checker },
  r: { tile: 'floor', mark: M.carpet },
  ';': { tile: 'floor', mark: M.glass },
  '+': { tile: 'floor', mark: M.mosaic },
  '^': { tile: 'floor', mark: M.seam },
  q: { tile: 'floor', mark: M.herring },
  s: { tile: 'floor', mark: M.obsidian },
  x: { tile: 'floor', mark: M.hex },
  U: { tile: 'floor', mark: M.bridge },
  F: { tile: 'floor', mark: M.rough },
  J: { tile: 'floor', mark: M.plank },
  // Осколки: режут понемногу и вяжут шаг.
  '*': { tile: 'hazard', mark: M.shards, hazard: { slow: 0.8, dps: 0.008 } },
  _: { tile: 'deep', mark: M.void },
  // Портьера на лице стены.
  d: { tile: 'wall', mark: M.mirror, obj: { kind: 'deco', ref: 'f7_drape', solid: 0 } },
  I: prop('deco', 'f7_pillar', 0.42, { light: { r: 2.4, tint: 'cold' } }),
  i: prop('deco', 'f7_candle', 0.28, { light: { r: 4.4, tint: 'cold' } }),
  j: prop('deco', 'f7_bust', 0.34),
  V: prop('breakable', 'f7_vase', 0.28, { hp: 1 }),
  h: prop('deco', 'f7_crystal', 0.36, { light: { r: 2.4, tint: 'teal' } }),
  H: prop('breakable', 'f7_crate', 0.4, { hp: 2 }),
  t: prop('deco', 'f7_vanity', 0.42),
  N: prop('deco', 'f7_cocoon', 0.24, { light: { r: 1.4, tint: 'violet' } }),
  W: prop('deco', 'f7_web', 0),
  z: prop('deco', 'f7_frozen', 0.4, { light: { r: 1.6, tint: 'cold' } }),
  e: prop('deco', 'f7_easel', 0.32),
  p: prop('deco', 'f7_prismstand', 0.3, { light: { r: 2.8, tint: 'violet' } }),
  y: prop('deco', 'f7_shardpile', 0),
  Z: prop('deco', 'f7_chandelier', 0, { light: { r: 5.6, tint: 'cold' } }),
  O: prop('breakable', 'f7_frame', 0.3, { hp: 3, loot: 'f7mat' }),
  Q: prop('breakable', 'f7_bigmirror', 0.9, { hp: 6, loot: 'f7_amalgam' }),
};
// Зеркала-переходы: «1»…«4» — сама рама (стоит, её не пройти насквозь),
// «5»…«8» — знак пары на полу ПЕРЕД рамой: там стоят, чтобы перенестись.
// Раньше знак и рама были одной клеткой, и рама закрывала стоящего героя.
for (let n = 1; n <= 4; n++) {
  LEGEND[String(n)] = {
    tile: 'floor',
    mark: M.under,
    obj: { kind: 'deco', ref: `f7_portal${n}`, solid: 0.3 },
    light: { r: 2.2, tint: F7_PORTAL_TINT[n - 1] },
  };
  LEGEND[String(n + 4)] = { tile: 'floor', mark: M.portal + n };
}

const glass = ['#dcf2fa', '#8fc4dc', '#3c5a78'];

const MOBS: MobDef[] = [
  {
    id: 'f7_echo',
    name: 'Отражение',
    many: 'отражений',
    hp: 14,
    dmg: 10,
    speed: 3.7,
    radius: 0.28,
    windup: 0.42,
    reach: 0.5,
    rest: 0.8,
    xp: 6,
    meat: null,
    mats: [
      ['f7mat', 0.3],
      ['f7_amalgam', 0.2],
    ],
    beast: true,
    brain: 'f7_echo',
    art: { kind: 'paint', id: 'f7_echo' },
    mass: 1.1,
    flinch: 0.4,
    eye: '#c8f6ff',
    light: 1.1,
    gore: glass,
  },
  {
    id: 'f7_golem',
    name: 'Стеклянный голем',
    many: 'стеклянных големов',
    hp: 42,
    dmg: 13,
    speed: 1.8,
    radius: 0.55,
    windup: 0.9,
    reach: 0.75,
    rest: 1.3,
    xp: 16,
    meat: null,
    mats: [
      ['f7mat', 0.6],
      ['f7_core', 0.25],
    ],
    beast: true,
    brain: 'f7_golem',
    art: { kind: 'paint', id: 'f7_golem' },
    mass: 5,
    flinch: 0,
    stunT: 0.1,
    eye: '#a8f4ff',
    light: 1.3,
    gore: ['#e8f8ff', '#9ad8ec', '#4a7a9a'],
  },
  {
    id: 'f7_phantom',
    name: 'Призрачная копия',
    many: 'призрачных копий',
    hp: 12,
    dmg: 10,
    speed: 4.4,
    radius: 0.27,
    windup: 0.45,
    reach: 0.5,
    rest: 1,
    xp: 7,
    meat: null,
    mats: [['f7_amalgam', 0.3]],
    beast: true,
    brain: 'f7_phantom',
    art: { kind: 'paint', id: 'f7_phantom' },
    fly: true,
    mass: 0.8,
    flinch: 0.5,
    eye: '#eaf6ff',
    light: 0.9,
    gore: ['#eaf4ff', '#a8c4e8', '#6a7aa8'],
  },
  {
    id: 'f7_shadow',
    name: 'Тень из рамы',
    many: 'теней из рам',
    hp: 14,
    dmg: 11,
    speed: 4,
    radius: 0.3,
    windup: 0.55,
    reach: 0.55,
    rest: 0.9,
    xp: 7,
    meat: null,
    mats: [['f7_amalgam', 0.25]],
    beast: true,
    brain: 'f7_shadow',
    art: { kind: 'paint', id: 'f7_shadow' },
    mass: 1.3,
    flinch: 0.35,
    eye: '#ffffff',
    gore: ['#1a1428', '#3a2e58', '#8a78c8'],
  },
  {
    id: 'f7_moth',
    name: 'Зеркальная бабочка',
    many: 'зеркальных бабочек',
    hp: 6,
    dmg: 7,
    speed: 3.4,
    radius: 0.24,
    windup: 0.8,
    reach: 0.4,
    rest: 2,
    xp: 3,
    meat: ['f7_nectar', 0.45, 1],
    mats: [['f7_wing', 0.35]],
    beast: true,
    brain: 'f7_moth',
    art: { kind: 'paint', id: 'f7_moth' },
    fly: true,
    mass: 0.5,
    flinch: 0.8,
    eye: '#fff4b8',
    light: 0.8,
    gore: ['#f0f8ff', '#c8a8f0', '#8ab8e0'],
  },
  {
    id: 'f7_spider',
    name: 'Осколочный паук',
    many: 'осколочных пауков',
    hp: 9,
    dmg: 9,
    speed: 4.6,
    radius: 0.26,
    windup: 0.45,
    reach: 0.35,
    rest: 0.9,
    xp: 5,
    meat: ['f7_jelly', 0.45, 1],
    mats: [['f7mat', 0.35]],
    beast: true,
    brain: 'f7_spider',
    art: { kind: 'paint', id: 'f7_spider' },
    mass: 0.9,
    flinch: 0.5,
    eye: '#ff6a98',
    gore: ['#bfe4f0', '#5a3a5a', '#e84a7a'],
  },
  {
    id: 'f7_prism',
    name: 'Призма',
    many: 'призм',
    hp: 11,
    dmg: 11,
    speed: 1.6,
    radius: 0.3,
    windup: 0.95,
    reach: 0.4,
    rest: 2.2,
    xp: 8,
    meat: null,
    mats: [['f7_core', 0.3]],
    beast: true,
    brain: 'f7_prism',
    art: { kind: 'paint', id: 'f7_prism' },
    fly: true,
    mass: 1.5,
    flinch: 0.3,
    eye: '#ffb8ff',
    light: 1.8,
    gore: ['#f4e8ff', '#c890ff', '#7ae0ff'],
  },
  {
    id: 'f7_thief',
    name: 'Стекольщик-воришка',
    many: 'стекольщиков-воришек',
    hp: 14,
    dmg: 5,
    speed: 4.4,
    radius: 0.27,
    windup: 0.4,
    reach: 0.4,
    rest: 1,
    xp: 12,
    meat: null,
    mats: [['f7_amalgam', 0.6]],
    beast: true,
    brain: 'f7_thief',
    art: { kind: 'paint', id: 'f7_thief' },
    mass: 1,
    flinch: 0.6,
    coins: 520,
    resume: 'flee',
    eye: '#ffe070',
    gore: ['#8a6a4a', '#d8e8f0', '#ffd040'],
  },
  {
    id: 'f7boss',
    name: 'Отражение героя',
    many: 'отражений героя',
    hp: 620,
    dmg: 30,
    speed: 3.5,
    radius: 0.5,
    windup: 0.5,
    reach: 0.9,
    rest: 0.8,
    xp: 700,
    meat: null,
    mats: [],
    beast: true,
    brain: 'f7_boss',
    art: { kind: 'paint', id: 'f7_boss' },
    mass: 9,
    boss: true,
    noAlbino: true,
    eye: '#c8f6ff',
    // Стекло ловит свет: в тёмной арене Отражение (и каждый Отблеск — поровну,
    // иначе копию выдал бы свет, а не тень) светится само.
    light: 2.6,
    gore: ['#e8f6ff', '#8ab8d8', '#3a4a6a'],
  },
  {
    // Копия босса в фазе теней: удар по ней — звон, и она рассыпается. Не
    // часть босса (полоса и победа — только настоящий).
    id: 'f7boss_copy',
    name: 'Отблеск',
    many: 'отблесков',
    hp: 60,
    dmg: 30,
    speed: 3.5,
    radius: 0.5,
    windup: 0.5,
    reach: 0.9,
    rest: 0.8,
    xp: 0,
    meat: null,
    mats: [],
    beast: false,
    brain: 'f7_copy',
    art: { kind: 'paint', id: 'f7_boss' },
    mass: 9,
    noAlbino: true,
    eye: '#c8f6ff',
    // Стекло ловит свет: в тёмной арене Отражение (и каждый Отблеск — поровну,
    // иначе копию выдал бы свет, а не тень) светится само.
    light: 2.6,
    gore: ['#e8f6ff', '#8ab8d8', '#3a4a6a'],
  },
];

/** Кто водится в Галерее: отражения из зеркал, копии, бабочки у коконов. */
const spawnGallery: SpawnSpec = {
  mobs: [
    ['f7_echo', 45],
    ['f7_phantom', 20],
    ['f7_moth', 20],
    ['f7_golem', 8],
    ['f7_spider', 7],
  ],
  density: 0.8,
  pack: [1, 2],
  filler: 'f7_echo',
  // Спящая стая: голем-страж и отражения вокруг.
  group: (i) => (i === 0 ? 'f7_golem' : 'f7_echo'),
  horde: null,
  treasure: null,
  nest: () => 'f7_echo',
};

const spawnCrystal: SpawnSpec = {
  ...spawnGallery,
  mobs: [
    ['f7_spider', 30],
    ['f7_golem', 22],
    ['f7_prism', 20],
    ['f7_echo', 18],
    ['f7_moth', 10],
  ],
  filler: 'f7_spider',
  group: (i) => (i === 0 ? 'f7_golem' : 'f7_spider'),
};

const spawnHall: SpawnSpec = {
  ...spawnGallery,
  mobs: [
    ['f7_echo', 45],
    ['f7_phantom', 30],
    ['f7_golem', 15],
    ['f7_prism', 10],
  ],
  filler: 'f7_echo',
  group: (i) => (i === 0 ? 'f7_phantom' : 'f7_echo'),
};

export const F7: FloorDef = {
  id: 7,
  name: 'Зеркальный лабиринт',
  lead: 'Зеркала повторяют каждый шаг. Не все проходы — проходы. В глубине ждёшь ты сам.',
  mapVer: 1,
  areas: [
    {
      id: F7_GALLERY,
      name: 'Галерея отражений',
      lead: 'Брошенный зеркальный дворец. Из зеркал выходят.',
      tier: 8,
      level: 9,
      ambient: 0.48,
      rows: MAP_F7_GALLERY,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.8, 0.86, 1.08], mix: '#3a3060', k: 0.12 },
        fog: '#07060e',
      },
      legend: LEGEND,
      mine: 'f7mine1',
      spawn: spawnGallery,
    },
    {
      id: F7_CRYSTAL,
      name: 'Хрустальный лабиринт',
      lead: 'Стены из хрусталя. Проход может оказаться отражением.',
      tier: 8,
      level: 9,
      ambient: 0.44,
      rows: MAP_F7_CRYSTAL,
      skin: {
        floor: 'slab',
        wall: 'rock',
        tint: { mul: [0.72, 0.9, 1.04], mix: '#1a4a5c', k: 0.14 },
        fog: '#040a0e',
      },
      legend: LEGEND,
      mine: 'f7mine2',
      spawn: spawnCrystal,
    },
    {
      id: F7_HALL,
      name: 'Зал Двойника',
      lead: 'В каждом зеркале — ты. Одно из отражений ждёт.',
      tier: 8,
      level: 9,
      ambient: 0.42,
      rows: MAP_F7_HALL,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.84, 0.82, 1.02], mix: '#2c1e44', k: 0.16 },
        fog: '#08050d',
      },
      legend: LEGEND,
      spawn: spawnHall,
    },
  ],
  boss: {
    id: 'f7boss',
    name: 'Отражение героя',
    lead: 'Зеркальная арена в Зале Двойника',
    area: F7_HALL,
    restMs: 20 * 60_000,
    mob: 'f7boss',
    script: 'f7boss',
    parts: ['f7boss'],
    loot: (rnd) => ({
      tokens: 55 + Math.floor(rnd() * 30),
      keys: rnd() < 0.65 ? 1 : 0,
      coins: 48_000,
      mats: {
        f7_visage: 1,
        f7_amalgam: 2 + Math.floor(rnd() * 3),
        f7_core: 2 + Math.floor(rnd() * 3),
        f7mat: 3 + Math.floor(rnd() * 4),
      },
    }),
  },
  mines: [
    {
      id: 'f7mine1',
      name: 'Шахта стекольщика',
      area: F7_GALLERY,
      windowMs: 60 * 60_000,
      ores: [12, 13],
      share: [0.22, 0.29, 0.36, 0.44, 0.52],
      pyrite: 0,
      blocks: 1.7,
    },
    {
      id: 'f7mine2',
      name: 'Хрустальная шахта',
      area: F7_CRYSTAL,
      windowMs: 3 * 60 * 60_000,
      ores: [12, 13],
      share: [0.28, 0.36, 0.44, 0.52, 0.6],
      pyrite: 0,
      blocks: 2.3,
    },
  ],
  mobs: MOBS,
  meats: [
    { id: 'f7_nectar', name: 'Зеркальный нектар', price: 26, heal: 0.2 },
    { id: 'f7_jelly', name: 'Паучий студень', price: 34, heal: 0.26 },
  ],
  mats: [
    {
      // Ходовой материал этажа (его роняют ящики, рамы и тайники; им чинят лифт).
      id: 'f7mat',
      name: 'Зеркальный осколок',
      price: 300,
      lead: 'Кусок старого зеркала. В нём ещё кто-то ходит.',
    },
    {
      id: 'f7_amalgam',
      name: 'Амальгама',
      price: 380,
      lead: 'Серебряная изнанка отражения. Тёплая, как живая.',
    },
    {
      id: 'f7_core',
      name: 'Ядро призмы',
      price: 460,
      lead: 'Сердцевина хрусталя: свет в ней ходит кругами.',
    },
    {
      id: 'f7_wing',
      name: 'Крыло-зеркальце',
      price: 280,
      lead: 'Крыло зеркальной бабочки. Смотреть в него долго не стоит.',
    },
    {
      id: 'f7_visage',
      name: 'Лик Отражения',
      price: 36_000,
      lead: 'Трофей. Твоё лицо — только холоднее и с трещиной.',
      stack: 1,
    },
  ],
  music: { explore: 'depths', boss: 'boss' },
  cover: '/ui/areas/f7.png',
};
