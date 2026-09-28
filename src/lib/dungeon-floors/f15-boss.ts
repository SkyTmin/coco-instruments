// Этаж 15 «Сердце подземелья» — половина агента «Сердце»: верхний район
// «Сердце» (камера с сердцем и арена финального босса всей игры), босс
// «Хозяин подземелья», его отголоски, материалы.
//
// ДОГОВОР С АГЕНТОМ «МИР» (`f15.ts`, меняет только сводящий):
//   • экспорт — F15_HEART_AREA, F15_BOSS, F15_BOSS_MOBS, F15_BOSS_MATS,
//     F15_BOSS_MEATS, F15_JOIN;
//   • F15_HEART_AREA — ВЕРХНИЙ район этажа: арена (`K`, ворота `G`),
//     табличка `T`, печать `S` и лестница `>`; своего лифта нет;
//   • нижний ряд его карты — пол ровно в столбцах F15_JOIN.x0…x1, остальное
//     стена; верхний ряд последнего района «Мира» — так же (стык);
//   • id — с приставкой `f15b_` или `f15boss`; босс — `f15boss`, трофей —
//     материал `f15mat` (на него могут встать сохранения игроков);
//   • правила этажа (`registerFloor(15)`) — только у «Мира»; здесь — только
//     сценарий босса (`f15-boss-brains.ts`) и рисунок (`f15-boss-art.ts`).
//
// Район «Сердце» (снизу вверх, карта — `scripts/dungeon/f15_boss.py`):
//   • Горловина — коридор от стыка, рёбра по стенам, вены сходятся к
//     сердцу; развилка: левая жилка к тайнику за треснувшей стеной, правая
//     — в Пазуху с пузырями и решёткой назад в преддверие;
//   • Преддверие — пять ниш с реликвиями пяти боссов (корона, секира,
//     череп змея, голова гидры, меч Короля демонов) и шестая, пустая —
//     она ждёт того, кто дошёл; табличка у клапана;
//   • Камера сердца — арена 29×27: мышечные стены с венами, глазами и
//     полипами, веер вен от кокона, корни, рёбра-арки, четыре спящих знака
//     памяти в четвертях; за сердцем — клапан-печать и лестница вниз.
//
// Бой — пять фаз (сценарий — `f15-boss-brains.ts`):
//   0 «ОТГОЛОСКИ» — кокон неуязвим; по очереди встают эхо Крысиного
//     короля, Минотавра, Красного змея, гидры и Короля демонов — у каждого
//     свой коронный приём; павшее эхо — трещина в коконе;
//   1 «ПРОБУЖДЕНИЕ» — кокон лопается, выходит химера: крылатый лев из
//     плоти и камня; когти, прыжок льва с меткой, каменные шипы по полу;
//   2 «ПОДЗЕМЕЛЬЕ ПОМНИТ» — четверти зала переписываются под прошлые
//     этажи: лава, вода бездны, зеркала, круги гидры, у каждой своя беда;
//   3 «КРЫЛЬЯ» — плиты спины лопаются, крылья: полёт, пике по линии через
//     зал, перья веером, порыв, сносящий в опасную четверть;
//   4 «СЕРДЦЕ» — он вырывает сердце: оболочка каменеет, истинное сердце
//     висит в центре и бьётся; стены сжимаются по пульсу, удар сердца
//     идёт кольцами, артерии хлещут, сгустки катятся; раскрылось — бей.
//     Последний удар — замедление и финал (`{t:'boss', what:'finale'}`).

import type { MobDef } from '../dungeon';
import { F15_HEART_MAP } from './f15-boss-map';
import type { AreaSpec, BossSpec, LegendCell, MatDefIn, MeatDef } from './types';

/** Стык района «Сердце» с районами «Мира»: столбцы прохода. */
export const F15_JOIN = { x0: 28, x1: 35 } as const;

/** Район-арена. */
export const F15_HEART = 'f15heart';

/**
 * Свои клетки района: номер вида для рисовальщика и сценария. Клетки,
 * которые сценарий ставит на ходу (`setTile`), — с 40.
 */
export const F15B_MARK = {
  flesh: 1,
  vein: 2,
  blood: 3,
  plate: 4,
  root: 5,
  bone: 6,
  sigLava: 7,
  sigAbyss: 8,
  sigMirror: 9,
  sigHydra: 10,
  // Стены (лицо стены и порода за ним).
  wall: 20,
  wallVein: 21,
  wallRib: 22,
  eye: 23,
  polyp: 24,
  lip: 25,
  relic: 26,
  // Сменённые на ходу: память прошлых этажей и сжатие.
  lava: 40,
  crust: 41,
  abyss: 42,
  shallow: 43,
  mirror: 44,
  mirrorFloor: 45,
  circleA: 46,
  circleB: 47,
  bog: 48,
  swell: 50,
  scorch: 51,
} as const;

const M = F15B_MARK;

/** Опасности клеток памяти (после «Движка 3» — прямо в `setTile`). */
export const F15B_HAZ = {
  crust: { status: 'burn', dur: 1.2, dps: 0.02 },
  shallow: { slow: 0.55 },
  bog: { status: 'poison', dur: 1.2 },
} as const;

const floorObj = (ref: string, solid: number, light?: LegendCell['light']): LegendCell => ({
  tile: 'floor',
  mark: M.flesh,
  obj: { kind: 'deco', ref, solid, ...(light ? { light } : {}) },
});
const wallObj = (ref: string, mark: number, light?: LegendCell['light']): LegendCell => ({
  tile: 'wall',
  mark,
  obj: { kind: 'deco', ref, solid: 0, ...(light ? { light } : {}) },
});

const LEGEND: Record<string, LegendCell> = {
  f: { tile: 'floor', mark: M.flesh },
  r: { tile: 'floor', mark: M.vein },
  x: { tile: 'floor', mark: M.blood },
  m: { tile: 'floor', mark: M.plate },
  h: { tile: 'floor', mark: M.root },
  k: { tile: 'floor', mark: M.bone },
  '1': { tile: 'floor', mark: M.sigLava, light: { r: 1.5, tint: 'warm' } },
  '2': { tile: 'floor', mark: M.sigAbyss, light: { r: 1.5, tint: 'teal' } },
  '3': { tile: 'floor', mark: M.sigMirror, light: { r: 1.5, tint: 'cold' } },
  '4': { tile: 'floor', mark: M.sigHydra, light: { r: 1.5, tint: 'green' } },
  W: { tile: 'wall', mark: M.wall },
  V: { tile: 'wall', mark: M.wallVein, light: { r: 1.4, tint: 'red' } },
  Q: { tile: 'wall', mark: M.wallRib },
  I: wallObj('f15b_eye', M.eye, { r: 1.8, tint: 'violet' }),
  J: wallObj('f15b_polyp', M.polyp, { r: 4.2, tint: 'red' }),
  H: wallObj('f15b_lip', M.lip),
  A: wallObj('f15b_relic_crown', M.relic, { r: 2.4, tint: 'warm' }),
  N: wallObj('f15b_relic_axe', M.relic, { r: 2.4, tint: 'red' }),
  O: wallObj('f15b_relic_skull', M.relic, { r: 2.4, tint: 'warm' }),
  U: wallObj('f15b_relic_hydra', M.relic, { r: 2.4, tint: 'green' }),
  Z: wallObj('f15b_relic_sword', M.relic, { r: 2.4, tint: 'violet' }),
  '7': wallObj('f15b_relic_empty', M.relic, { r: 1.6, tint: 'cold' }),
  // Кокон — под K: пока бой не начался, это он; в бою его рисует босс.
  F: { tile: 'floor', mark: M.plate, obj: { kind: 'deco', ref: 'f15b_cocoon', solid: 1.1 }, light: { r: 7.5, tint: 'red' } },
  g: floorObj('f15b_rib', 0.3),
  p: floorObj('f15b_tendon', 0.4),
  s: { tile: 'floor', mark: M.flesh, obj: { kind: 'breakable', ref: 'f15b_pustule', solid: 0.34, hp: 2, loot: 'f15b_ichor' } },
  d: floorObj('f15b_drip', 0),
  e: floorObj('f15b_vent', 0, { r: 1.6, tint: 'warm' }),
  t: floorObj('f15b_teeth', 0.3),
  '5': { tile: 'floor', mark: M.flesh, obj: { kind: 'deco', ref: 'f15b_bones', solid: 0.26, flat: true } },
  '6': { tile: 'floor', mark: M.vein, obj: { kind: 'deco', ref: 'f15b_node', solid: 0, flat: true }, light: { r: 2, tint: 'red' } },
};

// ---------------------------------------------------------------------------
// Монстры: хозяин, сердце, отголоски, сгусток.
// ---------------------------------------------------------------------------

const GORE_STONE = ['#3a3230', '#6e5e54', '#8a1c26', '#ff6a2a'];
const GORE_ECHO = ['#1c1a3a', '#3c5a8e', '#78b4d8', '#d8f4ff'];

/** Эхо: часть боя, призрак прошлого босса (рисунок — его же, перекрашенный). */
const echo = (
  id: string,
  name: string,
  many: string,
  hp: number,
  dmg: number,
  speed: number,
  radius: number,
  extra: Partial<MobDef> = {},
): MobDef => ({
  id,
  name,
  many,
  hp,
  dmg,
  speed,
  radius,
  windup: 0.7,
  reach: 0.8,
  rest: 0.9,
  xp: 260,
  meat: null,
  mats: [['f15b_echo', 0.7]],
  beast: false,
  brain: id,
  art: { kind: 'paint', id: 'f15b_echo' },
  mass: 12,
  boss: true,
  noAlbino: true,
  eye: '#d8f4ff',
  light: 2.2,
  gore: GORE_ECHO,
  ...extra,
});

export const F15_BOSS_MOBS: MobDef[] = [
  {
    id: 'f15boss',
    name: 'Хозяин подземелья',
    many: 'хозяев подземелья',
    hp: 1250,
    dmg: 30,
    speed: 2.7,
    radius: 1.25,
    windup: 0.8,
    reach: 1.2,
    rest: 0.9,
    xp: 1600,
    meat: null,
    mats: [],
    beast: true,
    brain: 'f15boss',
    art: { kind: 'paint', id: 'f15boss' },
    mass: 24,
    boss: true,
    noAlbino: true,
    eye: '#ffd040',
    light: 3.2,
    gore: GORE_STONE,
  },
  {
    id: 'f15boss_heart',
    name: 'Истинное сердце',
    many: 'истинных сердец',
    hp: 420,
    dmg: 24,
    speed: 0,
    radius: 1.05,
    windup: 0.8,
    reach: 0,
    rest: 1,
    xp: 1200,
    meat: null,
    mats: [],
    beast: false,
    brain: 'f15boss_heart',
    art: { kind: 'paint', id: 'f15boss_heart' },
    mass: 99,
    boss: true,
    noAlbino: true,
    fly: true,
    eye: '#ff4050',
    light: 4.5,
    gore: ['#5a0c18', '#c01c30', '#ff6070', '#ffd0a0'],
  },
  echo('f15b_echo_king', 'Эхо Крысиного короля', 'эх Крысиного короля', 120, 22, 3.1, 0.75),
  echo('f15b_echo_mino', 'Эхо Минотавра', 'эх Минотавра', 135, 25, 2.7, 0.8, { mass: 16 }),
  echo('f15b_echo_serpent', 'Эхо Красного змея', 'эх Красного змея', 135, 24, 2.3, 0.95, { mass: 16 }),
  echo('f15b_echo_hydra', 'Эхо гидры', 'эх гидры', 40, 22, 0, 1.2, { mass: 99, mats: [] }),
  echo('f15b_echo_head', 'Голова эха', 'голов эха', 52, 22, 0, 0.5, { mass: 99, fly: true, mats: [['f15b_echo', 0.3]] }),
  echo('f15b_echo_demon', 'Эхо Короля демонов', 'эх Короля демонов', 150, 26, 2.5, 0.95, { mass: 18 }),
  {
    id: 'f15b_clot',
    name: 'Кровяной сгусток',
    many: 'кровяных сгустков',
    hp: 13,
    dmg: 15,
    speed: 3.7,
    radius: 0.32,
    windup: 0.6,
    reach: 0.4,
    rest: 0.8,
    xp: 12,
    meat: null,
    mats: [['f15b_ichor', 0.14]],
    beast: true,
    brain: 'f15b_clot',
    art: { kind: 'paint', id: 'f15b_clot' },
    mass: 0.9,
    flinch: 0.6,
    eye: '#ff5060',
    gore: ['#5a0c18', '#a01828', '#d83040', '#2a0610'],
  },
];

// ---------------------------------------------------------------------------
// Район «Сердце».
// ---------------------------------------------------------------------------

export const F15_HEART_AREA: AreaSpec = {
  id: F15_HEART,
  name: 'Сердце',
  lead: 'Здесь бьётся подземелье. Реликвии у клапана — тех, кто правил выше.',
  tier: 8,
  level: 9,
  ambient: 0.46,
  rows: F15_HEART_MAP,
  // Плоть — всё: и пол, и стены, и буквы движка (ворота, печать, лестница).
  paintAll: true,
  skin: {
    floor: 'ground',
    wall: 'rock',
    tint: { mul: [0.82, 0.42, 0.44], mix: '#3a0612', k: 0.22 },
    fog: '#12030a',
  },
  legend: LEGEND,
  spawn: {
    mobs: [['f15b_clot', 1]],
    density: 0.35,
    pack: [1, 2],
    filler: 'f15b_clot',
    group: () => 'f15b_clot',
    horde: null,
    treasure: null,
    nest: () => 'f15b_clot',
  },
};

export const F15_BOSS: BossSpec = {
  id: 'f15boss',
  name: 'Хозяин подземелья',
  lead: 'Камера сердца в конце Горловины',
  area: F15_HEART,
  restMs: 20 * 60_000,
  mob: 'f15boss',
  script: 'f15boss',
  parts: [
    'f15boss',
    'f15boss_heart',
    'f15b_echo_king',
    'f15b_echo_mino',
    'f15b_echo_serpent',
    'f15b_echo_hydra',
    'f15b_echo_head',
    'f15b_echo_demon',
  ],
  loot: (rnd) => ({
    tokens: 120 + Math.floor(rnd() * 60),
    keys: 1 + (rnd() < 0.5 ? 1 : 0),
    coins: 150_000,
    mats: {
      f15mat: 1,
      f15b_plume: 2 + Math.floor(rnd() * 2),
      f15b_echo: 2 + Math.floor(rnd() * 2),
    },
  }),
};

export const F15_BOSS_MATS: MatDefIn[] = [
  {
    id: 'f15b_ichor',
    name: 'Ихор',
    price: 720,
    lead: 'Густая кровь подземелья. Светится изнутри и не сворачивается.',
  },
  {
    id: 'f15b_echo',
    name: 'Осколок эха',
    price: 1400,
    lead: 'Кусок чужой памяти. Если приложить к уху — слышно, как рычит король.',
  },
  {
    id: 'f15b_plume',
    name: 'Каменное перо',
    price: 2600,
    lead: 'Перо с крыла Хозяина: снаружи камень, внутри — живая жила.',
  },
  {
    id: 'f15mat',
    name: 'Сердце подземелья',
    price: 120_000,
    lead: 'Трофей последнего этажа. Оно ещё тёплое — и иногда бьётся.',
    stack: 1,
  },
];

export const F15_BOSS_MEATS: MeatDef[] = [];
