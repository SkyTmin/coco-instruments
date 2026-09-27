// Этаж 2 — «Грибной грот» (v2.81). Мотив — живая экосистема подземелья:
// здесь всё растёт, ползёт и ест друг друга, а монстры — это ещё и еда и
// материал (грибная мякоть, сушёная слизь, мясо мимика, корень мандрагоры).
// Названия и рисунки свои.
//
// Районы снизу вверх: «Грибной грот» (вход, лифт, шахта; роща и топи
// развилкой, ручей с мостками, сад мандрагор, корневой ход) и «Заросшие
// руины» (крепость, которую доедает грибница: галерея пустых лат, кладовая,
// подъёмник и вторая шахта, тронный зал — логово Живых доспехов, за печатью
// лестница вниз). Карта — `scripts/dungeon/f2.py` → `f2-map.ts`.
//
// ИИ и сценарий босса — `f2-brains.ts`, рисунки — `f2-art.ts`.

import type { MobDef } from '../dungeon';
import { MAP_F2_GROT, MAP_F2_RUIN } from './f2-map';
import type { FloorDef, LegendCell, SpawnSpec } from './types';

/**
 * Марки своих клеток (`LegendCell.mark`): их читают рисовальщик клеток
 * (`f2-art.ts`) и сценарий этажа (`f2-brains.ts` — где сидят мандрагоры,
 * мимики, хваталки и где капает слизь).
 */
export const MK = {
  mycel: 1,
  glowG: 2,
  glowV: 3,
  spore: 4,
  stream: 5,
  shallow: 6,
  bridge: 7,
  drip: 8,
  mandrake: 9,
  mimic: 10,
  snapper: 11,
  wallShroom: 12,
  bones: 13,
  roots: 14,
} as const;

/** Районы этажа. */
export const F2_GROT = 'f2grot';
export const F2_RUIN = 'f2ruin';

/** Части босса и его свита. */
export const F2_ARMOR = 'f2_armor';
export const F2_MITE = 'f2_mite';
export const F2_PLATE = 'f2_plate';
export const F2_BLADE = 'f2_blade';

const LEGEND: Record<string, LegendCell> = {
  // Грибница по полу: белёсые нити, ходить можно.
  m: { tile: 'floor', mark: MK.mycel },
  // Светящиеся грибочки — свет грота.
  g: { tile: 'floor', mark: MK.glowG, light: { r: 2.3, tint: 'green' } },
  i: { tile: 'floor', mark: MK.glowV, light: { r: 2.5, tint: 'violet' } },
  // Споровая лужа: травит, пока стоишь, и вязнет.
  h: { tile: 'hazard', mark: MK.spore, hazard: { status: 'poison', dur: 1.2, slow: 0.72 } },
  // Подземный ручей — не перейти, только по мосткам.
  w: { tile: 'deep', mark: MK.stream },
  j: { tile: 'hazard', mark: MK.shallow, hazard: { slow: 0.62 } },
  k: { tile: 'floor', mark: MK.bridge },
  // Капель со свода: там над головой живёт слизь.
  q: { tile: 'floor', mark: MK.drip },
  // Места монстров, которых расставляет сценарий этажа.
  '*': { tile: 'floor', mark: MK.mandrake },
  '&': { tile: 'floor', mark: MK.mimic },
  z: { tile: 'floor', mark: MK.snapper },
  // Стена с трутовиками.
  t: { tile: 'wall', mark: MK.wallShroom },
  y: { tile: 'floor', mark: MK.bones },
  r: { tile: 'floor', mark: MK.roots },
  // Грибы-великаны: светятся, сквозь ножку не пройти.
  f: {
    tile: 'floor',
    mark: MK.mycel,
    obj: { kind: 'deco', ref: 'f2_bigcap', solid: 0.4, light: { r: 3.4, tint: 'violet' } },
  },
  F: {
    tile: 'floor',
    mark: MK.mycel,
    obj: { kind: 'deco', ref: 'f2_bigcap_g', solid: 0.4, light: { r: 3.2, tint: 'green' } },
  },
  // Дождевики: бьются, как ящик.
  x: { tile: 'floor', obj: { kind: 'breakable', ref: 'f2_puffs', solid: 0.3, hp: 2 } },
  // Руины: пустые латы на стойках и колонны.
  A: { tile: 'floor', obj: { kind: 'deco', ref: 'f2_stand', solid: 0.3 } },
  I: { tile: 'floor', obj: { kind: 'deco', ref: 'f2_column', solid: 0.44 } },
};

const MOBS: MobDef[] = [
  {
    // Ходячий гриб: топает (круг у ног), от удара чихает спорами, умирая —
    // лопается облаком.
    id: 'f2_shroom',
    name: 'Гриб-топотун',
    many: 'грибов-топотунов',
    hp: 20,
    dmg: 10,
    speed: 2.2,
    radius: 0.34,
    windup: 0.62,
    reach: 0.5,
    rest: 1.1,
    xp: 6,
    meat: ['f2_cap', 0.6, 1],
    mats: [['f2_spores', 0.3]],
    beast: true,
    brain: 'f2_shroom',
    art: { kind: 'paint', id: 'f2_shroom' },
    mass: 1.8,
    flinch: 0.25,
    eye: '#f4ff9a',
    gore: ['#a8563a', '#eadcc0', '#5a3a30', '#d4ff7a'],
  },
  {
    // Грибёнок: мелкий, светится, бежит стайкой за старшими.
    id: 'f2_sprout',
    name: 'Грибёнок',
    many: 'грибят',
    hp: 8,
    dmg: 5,
    speed: 3.8,
    radius: 0.22,
    windup: 0.3,
    reach: 0.32,
    rest: 0.7,
    xp: 3,
    meat: ['f2_cap', 0.25, 1],
    mats: [['f2_spores', 0.1]],
    beast: true,
    brain: 'melee',
    art: { kind: 'paint', id: 'f2_sprout' },
    mass: 0.8,
    flinch: 0.6,
    zigzag: true,
    eye: '#e4c8ff',
    light: 1.1,
    gore: ['#8a62c0', '#e8d8ff', '#cfc4d8'],
  },
  {
    // Слизь: падает со свода, прыгает на героя и вяжет; обычный удар режет
    // её надвое, тяжёлый — давит целиком.
    id: 'f2_slime',
    name: 'Сводовая слизь',
    many: 'слизней',
    hp: 22,
    dmg: 8,
    speed: 1.5,
    radius: 0.36,
    windup: 0.6,
    reach: 0.4,
    rest: 1.2,
    xp: 6,
    meat: ['f2_jelly', 0.45, 1],
    mats: [['f2_core', 0.22]],
    beast: true,
    brain: 'f2_slime',
    art: { kind: 'paint', id: 'f2_slime' },
    mass: 1.4,
    // Обычный удар слизь не сбивает — режет: её «ответ» — деление.
    flinch: 0,
    stunT: 0.35,
    hit: { status: 'slow', dur: 2.2, push: 2 },
    eye: '#c8ff7a',
    gore: ['#4f8a3a', '#86c24e', '#d6f7a0', '#2c5226'],
  },
  {
    // Мандрагора: сидит в земле, подпускает и кричит — кольцо на полу,
    // внутри оглушает. Выйти из кольца или проскочить рывком.
    id: 'f2_mandrake',
    name: 'Мандрагора',
    many: 'мандрагор',
    hp: 18,
    dmg: 5,
    speed: 0,
    radius: 0.3,
    windup: 1,
    reach: 3,
    rest: 2.4,
    xp: 9,
    meat: ['f2_root', 0.8, 1],
    mats: [],
    beast: true,
    brain: 'f2_mandrake',
    art: { kind: 'paint', id: 'f2_mandrake' },
    mass: 99,
    flinch: 1,
    noAlbino: true,
    eye: '#ff5a3a',
    gore: ['#6aa84a', '#d0a07a', '#8a5a4a'],
  },
  {
    // Мимик: живёт в сундуке, как рак-отшельник в раковине. Пока герой не
    // подошёл — сундук; подошёл — лапы, клешни и пасть.
    id: 'f2_mimic',
    name: 'Сундучный рак',
    many: 'сундучных раков',
    hp: 46,
    dmg: 14,
    speed: 3.7,
    radius: 0.42,
    windup: 0.45,
    reach: 0.5,
    rest: 0.9,
    xp: 16,
    meat: ['f2_crab', 0.9, 2],
    mats: [['f2_claw', 0.45]],
    beast: true,
    brain: 'f2_mimic',
    art: { kind: 'paint', id: 'f2_mimic' },
    mass: 3,
    flinch: 0.2,
    stunT: 0.3,
    noAlbino: true,
    coins: 600,
    eye: '#ffb04a',
    gore: ['#8a4a2a', '#d8a83a', '#5a2420', '#c05a3a'],
  },
  {
    // Хваталка: хищная лиана, вросшая в пол. Целится линией и выстреливает
    // пастью на три клетки; вблизи — безопасна, пока втягивается.
    id: 'f2_snapper',
    name: 'Хваталка',
    many: 'хваталок',
    hp: 28,
    dmg: 12,
    speed: 0,
    radius: 0.38,
    windup: 0.75,
    reach: 3.3,
    rest: 1.4,
    xp: 8,
    meat: null,
    mats: [['f2_spores', 0.35]],
    beast: true,
    brain: 'f2_snapper',
    art: { kind: 'paint', id: 'f2_snapper' },
    mass: 99,
    flinch: 0.3,
    noAlbino: true,
    eye: '#ff4a6a',
    gore: ['#4f8a3a', '#a82a3a', '#2f5a2a'],
  },
  {
    // Монетный жук: панцирь — куча монет и камушков. Удирает к норе.
    id: 'f2_coinbug',
    name: 'Монетный жук',
    many: 'монетных жуков',
    hp: 34,
    dmg: 0,
    speed: 5,
    radius: 0.26,
    windup: 0,
    reach: 0,
    rest: 0,
    xp: 20,
    meat: null,
    mats: [['f2_claw', 0.5]],
    beast: true,
    brain: 'flee',
    art: { kind: 'paint', id: 'f2_coinbug' },
    mass: 1,
    flinch: 1,
    noAlbino: true,
    coins: 2_000,
    eye: '#fff0a0',
    gore: ['#d8a83a', '#fff0a8', '#3a2a1a'],
    resume: 'flee',
  },
  // --- Босс: Живые доспехи ---
  {
    // Пустые латы, внутри рой. Разбил латы — рой на воле; не добил рой —
    // латы собираются обратно.
    id: F2_ARMOR,
    name: 'Живые доспехи',
    many: 'живых доспехов',
    hp: 2000,
    dmg: 15,
    speed: 2,
    radius: 0.7,
    windup: 0.72,
    reach: 1.2,
    rest: 1,
    xp: 300,
    meat: null,
    mats: [],
    beast: true,
    brain: 'f2_armor',
    art: { kind: 'paint', id: 'f2_armor' },
    mass: 9,
    boss: true,
    noAlbino: true,
    eye: '#d0a0ff',
    gore: ['#8b8f94', '#c4c8cc', '#4b4e53', '#b07cff'],
  },
  {
    // Латник — моллюск роя. Их держат латы; без лат они кусают сами.
    id: F2_MITE,
    name: 'Латник',
    many: 'латников',
    hp: 13,
    dmg: 4,
    speed: 3.9,
    radius: 0.2,
    windup: 0.3,
    reach: 0.3,
    rest: 0.8,
    xp: 4,
    meat: null,
    mats: [['f2_shell', 0.25]],
    beast: false,
    brain: 'f2_mite',
    art: { kind: 'paint', id: 'f2_mite' },
    mass: 0.6,
    stunT: 0.35,
    boss: true,
    noAlbino: true,
    eye: '#e0c8ff',
    light: 0.6,
    gore: ['#d8c8a8', '#8a62c0', '#f4ead4'],
  },
  {
    // Обломок лат: лежит на полу, пока рой на воле; ползёт к остальным,
    // когда доспех собирается. Недосягаем.
    id: F2_PLATE,
    name: 'Обломок лат',
    many: 'обломков лат',
    hp: 1,
    dmg: 0,
    speed: 1.8,
    radius: 0.24,
    windup: 0,
    reach: 0,
    rest: 0,
    xp: 0,
    meat: null,
    mats: [],
    beast: false,
    brain: 'f2_plate',
    art: { kind: 'paint', id: 'f2_plate' },
    mass: 30,
    noAlbino: true,
  },
  {
    // Живой клинок: меч лат летает сам, пока рой на воле, и колет выпадом.
    id: F2_BLADE,
    name: 'Клинок лат',
    many: 'клинков лат',
    hp: 1,
    dmg: 9,
    speed: 5,
    radius: 0.24,
    windup: 0.8,
    reach: 4,
    rest: 2.6,
    xp: 0,
    meat: null,
    mats: [],
    beast: false,
    brain: 'f2_blade',
    art: { kind: 'paint', id: 'f2_blade' },
    mass: 30,
    fly: true,
    noAlbino: true,
    light: 1.2,
    eye: '#d0a0ff',
  },
];

/** Спящие стаи грота: грибы с грибятами. */
const group = (i: number) => (i === 0 || i === 3 ? 'f2_shroom' : 'f2_sprout');

const spawnGrot: SpawnSpec = {
  mobs: [
    ['f2_shroom', 46],
    ['f2_sprout', 30],
    ['f2_slime', 24],
  ],
  density: 0.9,
  pack: [2, 2],
  filler: 'f2_sprout',
  group,
  horde: null,
  treasure: 'f2_coinbug',
  nest: () => 'f2_sprout',
};

const spawnRuin: SpawnSpec = {
  mobs: [
    ['f2_shroom', 34],
    ['f2_slime', 36],
    ['f2_sprout', 30],
  ],
  density: 1,
  pack: [2, 3],
  filler: 'f2_sprout',
  group: (i, _n, rnd) => (i === 0 ? 'f2_shroom' : rnd() < 0.4 ? 'f2_slime' : 'f2_sprout'),
  horde: null,
  treasure: 'f2_coinbug',
  nest: () => 'f2_sprout',
};

export const F2: FloorDef = {
  id: 2,
  name: 'Грибной грот',
  lead: 'Грот, где всё растёт и ест друг друга. Выше — руины и Живые доспехи.',
  mapVer: 1,
  areas: [
    {
      id: F2_GROT,
      name: 'Грибной грот',
      lead: 'Грибы ходят, слизь капает со свода, корни кричат.',
      tier: 3,
      level: 2,
      ambient: 0.44,
      rows: MAP_F2_GROT,
      skin: {
        floor: 'ground',
        wall: 'rock',
        tint: { mul: [0.84, 0.9, 0.88], mix: '#2a1e3a', k: 0.14 },
        fog: '#0b0812',
      },
      mine: 'f2mine1',
      legend: LEGEND,
      spawn: spawnGrot,
    },
    {
      id: F2_RUIN,
      name: 'Заросшие руины',
      lead: 'Крепость, которую доедает грибница. Латы на стойках — пустые?',
      tier: 4,
      level: 3,
      ambient: 0.38,
      rows: MAP_F2_RUIN,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.8, 0.86, 0.86], mix: '#26303a', k: 0.12 },
        fog: '#07080d',
      },
      mine: 'f2mine2',
      legend: LEGEND,
      spawn: spawnRuin,
    },
  ],
  boss: {
    id: F2_ARMOR,
    name: 'Живые доспехи',
    lead: 'Тронный зал Заросших руин',
    area: F2_RUIN,
    restMs: 20 * 60_000,
    mob: F2_ARMOR,
    script: 'f2_armor',
    parts: [F2_ARMOR, F2_MITE],
    loot: (rnd) => ({
      tokens: 30 + Math.floor(rnd() * 20),
      keys: rnd() < 0.5 ? 1 : 0,
      coins: 16_000,
      mats: { f2_sword: 1, f2_shell: 6 + Math.floor(rnd() * 5) },
    }),
  },
  mines: [
    {
      id: 'f2mine1',
      name: 'Известковая штольня',
      area: F2_GROT,
      windowMs: 60 * 60_000,
      ores: [2, 3],
      share: [0.2, 0.26, 0.32, 0.4, 0.48],
      pyrite: 0.15,
      blocks: 1.3,
    },
    {
      id: 'f2mine2',
      name: 'Гранитный забой',
      area: F2_RUIN,
      windowMs: 3 * 60 * 60_000,
      ores: [2, 3],
      share: [0.24, 0.3, 0.38, 0.46, 0.55],
      pyrite: 0.1,
      blocks: 1.9,
    },
  ],
  mobs: MOBS,
  meats: [
    { id: 'f2_cap', name: 'Грибная мякоть', price: 22, heal: 0.15 },
    { id: 'f2_jelly', name: 'Сушёная слизь', price: 30, heal: 0.2 },
    { id: 'f2_crab', name: 'Мясо мимика', price: 60, heal: 0.3 },
    { id: 'f2_root', name: 'Корень мандрагоры', price: 80, heal: 0.35 },
  ],
  mats: [
    {
      id: 'f2_spores',
      name: 'Мешочек спор',
      price: 30,
      lead: 'Ядовитая пыль грибов — на обмазку клинка.',
    },
    {
      id: 'f2_core',
      name: 'Ядро слизи',
      price: 45,
      lead: 'Упругий комок: держит подошву на мокром камне.',
    },
    {
      id: 'f2_claw',
      name: 'Клешня мимика',
      price: 70,
      lead: 'Прочнее сундучной оковки — на накладки брони.',
    },
    {
      id: 'f2_shell',
      name: 'Раковина латника',
      price: 40,
      lead: 'Створка моллюска из лат: лёгкая и крепкая пластина.',
    },
    {
      id: 'f2_sword',
      name: 'Живой клинок',
      price: 9_000,
      lead: 'Трофей. Меч Живых доспехов — в рукояти ещё шевелится рой.',
      stack: 1,
    },
  ],
  music: { explore: 'forest', boss: 'boss' },
  cover: '/ui/areas/f2grot.png',
};
