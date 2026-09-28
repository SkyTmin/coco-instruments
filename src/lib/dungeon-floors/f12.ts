// Этаж 12 — «Проклятая станция». Заброшенное метро под лагерем: белая
// плитка в трещинах, турникеты, эскалаторы, неон, вагоны, семафоры — и
// проклятия, которые выросли из страха тысяч пассажиров. Названия свои.
//
// ГЛАГОЛ ЭТАЖА — ПОЕЗДА И ТЕРРИТОРИИ:
//   • поезда ходят по расписанию. Семафор жёлтый — скоро, красный — рельсы
//     гудят, из темноты тоннеля встают фары, гудок, пол дрожит — и состав
//     проносится по всей линии. Кого застал на путях — сбит: героя
//     отбрасывает с тяжёлым уроном, монстров — насмерть. Стаю можно
//     заманить на рельсы под поезд;
//   • эскалаторы — ленты, которые несут и героя, и монстров;
//   • проклятые территории — круг со своими правилами: внутри метка
//     «верного удара» ходит за героем, и рывок не спасает (она ждёт, пока
//     рывок кончится). Выйти — за край круга или разбить три столба.
// Глагол растёт: в Вестибюле — одна служебная ветка, в Платформах — две
// линии, тоннели с нишами и узловая с четырьмя путями и стрелкой, в
// Святилище — поезд-призрак и «Малая территория», у босса — поезд через
// арену (его можно подставить) и расширение территории на весь зал.
//
// Районы (снизу вверх):
//   • «Вестибюль» (`f12`, вход) — лифтовый холл и первая линия прямо за ним,
//     кассы с тайником, кассовый зал с турникетами (событие «Час пик»),
//     эскалаторный наклон (событие «Бегущая лестница»), служебная лестница с
//     шахтой, машинный зал и служебный коридор с решёткой-срезкой;
//   • «Платформы и туннели» (`f12plat`) — станция с островной платформой
//     (событие «Сбой света», щиток), перегоны с нишами (событие
//     «Встречный»), депо со стоящими вагонами, узловая с четырьмя путями и
//     стрелочным рычагом;
//   • «Святилище под перегоном» (`f12shrine`) — провал под путями, галерея
//     талисманов, «Малая территория» (событие), старый перегон с
//     поездом-призраком (событие «Последний поезд»), шахта, преддверие и
//     арена «Жертвенный храм».
//
// Монстры (ИИ — `f12-brains.ts`, рисунок — `f12-art.ts`):
//   • рой мух — мелочь стаей, зигзаг, яд;
//   • многоликий — глыба из лиц: удар сверху и КРИК — три кольца волной;
//   • длиннорукий — живёт в треснувшей стене коридора: рука линией через
//     проход хватает и тянет к стене; открыт, пока рука снаружи;
//   • спящий пассажир — дремлет на скамье, не трогай — не встанет; поезд,
//     удар или бег рядом будят — рывок пастью по линии;
//   • глаз на своде — прожектор взгляда конусом; заметил — слеза навесом и
//     зовёт мух; моргнул — открыт;
//   • кукла-заклинатель — держится за спинами, ставит МАЛУЮ ТЕРРИТОРИЮ вокруг
//     героя (круг и три столба), бросает иглы веером;
//   • оживший плакат — плоский, скользит по стене недосягаемым; отлипает —
//     бумажные порезы серией; после серии смят и открыт;
//   • турникетный страж — у барьера, щит спереди, тычок створкой и таран по
//     линии; бей сбоку и сзади;
//   • путевой обходчик — ходит тоннелями с красным фонарём; машет им —
//     ВЫЗЫВАЕТ поезд вне расписания на путь, где ты стоишь;
//   • безбилетник (редкий) — с мешком, перемахивает турникеты, от ударов
//     сыплет монеты.
// Босс — Двуликий король проклятий (`f12boss`): рассечения по линиям,
// пламя через арену, РАСШИРЕНИЕ ТЕРРИТОРИИ: ЖЕРТВЕННЫЙ ХРАМ (зал
// переписывается, разрезы сеткой, укрытие — загорающиеся круги-обереги, три
// чаши держат храм), и всё вместе. Поезд идёт через арену по расписанию:
// подставил под него короля — тяжёлый урон и оглушение.
//
// Карта — `scripts/dungeon/f12.py` → `f12-map.ts` (руками не править).

import type { MobDef } from '../dungeon';
import { MAP_F12_HALL, MAP_F12_PLAT, MAP_F12_SHRINE } from './f12-map';
import type { FloorDef, LegendCell, SpawnSpec } from './types';

/** Свои клетки этажа: номер вида для рисовальщика и правил этажа. */
export const F12_MARK = {
  // Пол.
  tile: 1,
  mosaic: 2,
  edge: 3,
  railN: 4,
  railS: 5,
  crossN: 6,
  crossS: 7,
  escN: 8,
  escS: 9,
  esc0: 10,
  grate: 11,
  blood: 12,
  crack: 13,
  soot: 14,
  wet: 15,
  ballast: 16,
  niche: 17,
  shrine: 18,
  bones: 19,
  rune: 20,
  dais: 21,
  tunnelS: 22,
  abyss: 23,
  sleepPost: 24,
  eyePost: 25,
  linePost: 26,
  dollPost: 27,
  guardPost: 28,
  tunnelN: 29,
  comb: 30,
  hatch: 31,
  // Стены (лицо стены).
  wTile: 40,
  wMosaic: 41,
  wName: 42,
  wTunnel: 43,
  wPoster: 44,
  wOfuda: 45,
  wPortal: 46,
  wCar: 47,
  wArm: 48,
  wFix: 49,
  wBalus: 50,
  wKassa: 51,
  wShrine: 52,
  // Клетки, сменённые на ходу (`setTile`): территория храма, огонь, замки.
  domain: 60,
  domainWall: 61,
  burnt: 62,
  locked: 63,
} as const;

/** Районы этажа. `f12` — вход: на нём могут стоять сохранения. */
export const F12_HALL = 'f12';
export const F12_PLAT = 'f12plat';
export const F12_SHRINE = 'f12shrine';

const M = F12_MARK;

/** Свои буквы карты — одни на все три района. */
const LEGEND: Record<string, LegendCell> = {
  // Пол.
  t: { tile: 'floor', mark: M.tile },
  m: { tile: 'floor', mark: M.mosaic },
  y: { tile: 'floor', mark: M.edge },
  '=': { tile: 'floor', mark: M.railN },
  '-': { tile: 'floor', mark: M.railS },
  h: { tile: 'floor', mark: M.crossN },
  j: { tile: 'floor', mark: M.crossS },
  '^': { tile: 'floor', mark: M.escN },
  ';': { tile: 'floor', mark: M.escS },
  ':': { tile: 'floor', mark: M.esc0 },
  c: { tile: 'floor', mark: M.comb },
  f: { tile: 'floor', mark: M.hatch },
  g: { tile: 'floor', mark: M.grate },
  k: { tile: 'floor', mark: M.blood },
  q: { tile: 'floor', mark: M.crack },
  z: { tile: 'floor', mark: M.soot },
  w: { tile: 'floor', mark: M.wet },
  e: { tile: 'floor', mark: M.ballast },
  p: { tile: 'floor', mark: M.niche, light: { r: 1.8, tint: 'warm' } },
  s: { tile: 'floor', mark: M.shrine },
  r: { tile: 'floor', mark: M.bones },
  i: { tile: 'floor', mark: M.rune, light: { r: 1.5, tint: 'violet' } },
  d: { tile: 'floor', mark: M.dais },
  // Тоннель за краем станции: рельсы уходят в темноту — туда не пройти, но
  // поезд оттуда выходит (глубина: не стена, у неё нет лица).
  ')': { tile: 'deep', mark: M.tunnelN },
  _: { tile: 'deep', mark: M.tunnelS },
  // Провал под путями.
  '(': { tile: 'deep', mark: M.abyss },
  // Посты: пол, на котором ждёт житель станции (ставит сценарий этажа).
  Z: { tile: 'floor', mark: M.sleepPost },
  O: { tile: 'floor', mark: M.eyePost },
  '8': { tile: 'floor', mark: M.linePost },
  x: { tile: 'floor', mark: M.dollPost },
  '9': { tile: 'floor', mark: M.guardPost },
  // Стены.
  W: { tile: 'wall', mark: M.wTile },
  Q: { tile: 'wall', mark: M.wMosaic },
  N: { tile: 'wall', mark: M.wName },
  J: { tile: 'wall', mark: M.wTunnel },
  F: { tile: 'wall', mark: M.wPoster },
  A: { tile: 'wall', mark: M.wOfuda },
  V: { tile: 'wall', mark: M.wPortal },
  U: { tile: 'wall', mark: M.wCar },
  H: { tile: 'wall', mark: M.wArm },
  v: { tile: 'wall', mark: M.wBalus },
  u: { tile: 'wall', mark: M.wKassa, light: { r: 1.6, tint: 'warm' } },
  n: { tile: 'wall', mark: M.wShrine },
  // Настенное: часы, неон, лампы дневного света, сигнал, щиток.
  I: { tile: 'wall', mark: M.wFix, obj: { kind: 'deco', ref: 'f12_clock', solid: 0 } },
  '<': {
    tile: 'wall',
    mark: M.wFix,
    obj: { kind: 'deco', ref: 'f12_neon', solid: 0 },
    light: { r: 3.4, tint: 'teal' },
  },
  '{': {
    tile: 'wall',
    mark: M.wFix,
    obj: { kind: 'deco', ref: 'f12_tube', solid: 0 },
    light: { r: 4.6, tint: 'cold' },
  },
  '}': {
    tile: 'wall',
    mark: M.wFix,
    obj: { kind: 'deco', ref: 'f12_signal', solid: 0 },
    light: { r: 1.8, tint: 'red' },
  },
  '|': {
    tile: 'wall',
    mark: M.wFix,
    obj: { kind: 'deco', ref: 'f12_breaker', solid: 0 },
    light: { r: 1.4, tint: 'green' },
  },
  // Балюстрада эскалатора с торшером.
  L: {
    tile: 'wall',
    mark: M.wBalus,
    obj: { kind: 'deco', ref: 'f12_torch', solid: 0 },
    light: { r: 3.6, tint: 'warm' },
  },
  // Предметы на полу.
  '1': { tile: 'floor', mark: M.tile, obj: { kind: 'deco', ref: 'f12_turnstile', solid: 0.34 } },
  '2': { tile: 'floor', mark: M.tile, obj: { kind: 'deco', ref: 'f12_bench', solid: 0.34 } },
  '3': {
    tile: 'floor',
    mark: M.tile,
    obj: { kind: 'breakable', ref: 'f12_soda', solid: 0.4, hp: 3, loot: 'f12_snack' },
    light: { r: 2.4, tint: 'teal' },
  },
  '4': {
    tile: 'floor',
    mark: M.tile,
    obj: { kind: 'deco', ref: 'f12_ticketer', solid: 0.38 },
    light: { r: 1.8, tint: 'cold' },
  },
  '5': { tile: 'floor', mark: M.tile, obj: { kind: 'deco', ref: 'f12_column', solid: 0.46 } },
  '6': { tile: 'floor', mark: M.tile, obj: { kind: 'breakable', ref: 'f12_bin', solid: 0.26, hp: 1 } },
  '7': { tile: 'floor', obj: { kind: 'deco', ref: 'f12_semaphore', solid: 0.2 } },
  '0': {
    tile: 'floor',
    mark: M.shrine,
    obj: { kind: 'deco', ref: 'f12_lantern', solid: 0.3 },
    light: { r: 3.6, tint: 'warm' },
  },
  '&': { tile: 'floor', mark: M.shrine, obj: { kind: 'deco', ref: 'f12_torii', solid: 0 } },
  '*': {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f12_candles', solid: 0.16 },
    light: { r: 3, tint: 'warm' },
  },
  '+': { tile: 'floor', mark: M.bones, obj: { kind: 'deco', ref: 'f12_bonepile', solid: 0.3 } },
  '?': {
    tile: 'floor',
    mark: M.shrine,
    obj: { kind: 'deco', ref: 'f12_altar', solid: 0.5 },
    light: { r: 2.2, tint: 'red' },
  },
  '[': { tile: 'floor', obj: { kind: 'deco', ref: 'f12_buffer', solid: 0.45 } },
  ']': { tile: 'floor', obj: { kind: 'breakable', ref: 'f12_drum', solid: 0.36, hp: 2 } },
  '/': {
    tile: 'floor',
    obj: { kind: 'deco', ref: 'f12_spark', solid: 0 },
    light: { r: 1.6, tint: 'cold' },
  },
  P: { tile: 'floor', obj: { kind: 'deco', ref: 'f12_handcar', solid: 0.5 } },
  B: { tile: 'floor', mark: M.tile, obj: { kind: 'deco', ref: 'f12_kiosk', solid: 0.5 } },
  // Действия этажа: стрелочный рычаг и колокол дежурной (щиток — на стене).
  '!': { tile: 'floor', obj: { kind: 'deco', ref: 'f12_lever', solid: 0.22 } },
  l: {
    tile: 'floor',
    mark: M.tile,
    obj: { kind: 'deco', ref: 'f12_bell', solid: 0.22 },
    light: { r: 1.4, tint: 'red' },
  },
};

const GORE_CURSE = ['#1c1024', '#6a2a8a', '#c04aa0', '#0e0a14'];

/**
 * Монстры. База — этаж 10 ×1,2 (§12в): уровень района 9, рост силы
 * базовыми числами.
 */
const MOBS: MobDef[] = [
  {
    id: 'f12_flies',
    name: 'Рой мух',
    many: 'роёв мух',
    hp: 14,
    dmg: 10,
    speed: 4.4,
    radius: 0.26,
    windup: 0.36,
    reach: 0.34,
    rest: 0.7,
    xp: 6,
    meat: null,
    mats: [['f12mat', 0.1]],
    beast: true,
    brain: 'f12_flies',
    art: { kind: 'paint', id: 'f12_flies' },
    mass: 0.5,
    flinch: 0.6,
    fly: true,
    zigzag: true,
    hit: { status: 'poison', dur: 1.6, push: 1 },
    eye: '#c8ff5a',
    gore: ['#1a1a14', '#3a3a24', '#8aa040', '#0c0c08'],
  },
  {
    id: 'f12_manyface',
    name: 'Многоликий',
    many: 'многоликих',
    hp: 76,
    dmg: 24,
    speed: 2.3,
    radius: 0.52,
    windup: 0.85,
    reach: 0.75,
    rest: 1.2,
    xp: 22,
    meat: null,
    mats: [
      ['f12mat', 0.45],
      ['f12_finger', 0.04],
    ],
    beast: true,
    brain: 'f12_manyface',
    art: { kind: 'paint', id: 'f12_manyface' },
    mass: 5,
    flinch: 0.08,
    stunT: 0.3,
    eye: '#ffe0a0',
    gore: ['#3a2a30', '#8a5a5a', '#d8b0a0', '#1a1016'],
  },
  {
    id: 'f12_longarm',
    name: 'Длиннорукий',
    many: 'длинноруких',
    hp: 52,
    dmg: 22,
    speed: 0,
    radius: 0.4,
    windup: 0.7,
    reach: 3.4,
    rest: 1.2,
    xp: 20,
    meat: null,
    mats: [
      ['f12mat', 0.35],
      ['f12_talisman', 0.1],
    ],
    beast: true,
    brain: 'f12_longarm',
    art: { kind: 'paint', id: 'f12_longarm' },
    mass: 99,
    flinch: 0,
    noAlbino: true,
    eye: '#ff4a3a',
    gore: GORE_CURSE,
  },
  {
    id: 'f12_sleeper',
    name: 'Спящий пассажир',
    many: 'спящих пассажиров',
    hp: 44,
    dmg: 24,
    speed: 3.5,
    radius: 0.36,
    windup: 0.55,
    reach: 0.5,
    rest: 1,
    xp: 16,
    meat: ['f12_snack', 0.35, 1],
    mats: [['f12mat', 0.3]],
    beast: true,
    brain: 'f12_sleeper',
    art: { kind: 'paint', id: 'f12_sleeper' },
    mass: 1.8,
    flinch: 0.3,
    stunT: 0.25,
    eye: '#ff3a50',
    gore: ['#2a2228', '#6a5a60', '#a02838', '#141014'],
  },
  {
    id: 'f12_eye',
    name: 'Глаз на своде',
    many: 'глаз на своде',
    hp: 38,
    dmg: 20,
    speed: 0.6,
    radius: 0.4,
    windup: 1,
    reach: 6,
    rest: 1.4,
    xp: 18,
    meat: null,
    mats: [
      ['f12_lens', 0.4],
      ['f12mat', 0.1],
    ],
    beast: true,
    brain: 'f12_eye',
    art: { kind: 'paint', id: 'f12_eye' },
    mass: 99,
    flinch: 0,
    fly: true,
    noAlbino: true,
    eye: '#ffd040',
    light: 1.6,
    shot: { speed: 6, r: 0.5, life: 2, dmg: 1, art: 'f12_tear', lob: true, status: 'slow', dur: 1.4 },
    gore: ['#4a0a14', '#c01430', '#f0e0d0', '#1a0408'],
  },
  {
    id: 'f12_doll',
    name: 'Кукла-заклинатель',
    many: 'кукол-заклинателей',
    hp: 34,
    dmg: 18,
    speed: 2.8,
    radius: 0.3,
    windup: 0.9,
    reach: 5.5,
    rest: 1.5,
    xp: 20,
    meat: null,
    mats: [
      ['f12_talisman', 0.35],
      ['f12mat', 0.15],
    ],
    beast: true,
    brain: 'f12_doll',
    art: { kind: 'paint', id: 'f12_doll' },
    mass: 1,
    flinch: 0.5,
    eye: '#e070ff',
    light: 1.2,
    shot: { speed: 8, r: 0.28, life: 1.2, dmg: 0.6, art: 'f12_needle', n: 3, spread: 0.5 },
    gore: ['#2a1a1a', '#e8dcc8', '#a02030', '#140c0c'],
  },
  {
    id: 'f12_poster',
    name: 'Оживший плакат',
    many: 'оживших плакатов',
    hp: 30,
    dmg: 18,
    speed: 4.2,
    radius: 0.34,
    windup: 0.45,
    reach: 0.9,
    rest: 1.4,
    xp: 16,
    meat: null,
    mats: [['f12mat', 0.25]],
    beast: true,
    brain: 'f12_poster',
    art: { kind: 'paint', id: 'f12_poster' },
    mass: 0.6,
    flinch: 0.5,
    noAlbino: true,
    eye: '#ff5a30',
    gore: ['#e8dcc0', '#c04030', '#3a6aa0', '#1a1410'],
  },
  {
    id: 'f12_turnstile',
    name: 'Турникетный страж',
    many: 'турникетных стражей',
    hp: 86,
    dmg: 26,
    speed: 2.2,
    radius: 0.55,
    windup: 0.8,
    reach: 1,
    rest: 1.2,
    xp: 26,
    meat: null,
    mats: [
      ['f12mat', 0.6],
      ['f12_talisman', 0.08],
    ],
    beast: true,
    brain: 'f12_turnstile',
    art: { kind: 'paint', id: 'f12_turnstile' },
    mass: 7,
    flinch: 0.04,
    stunT: 0.35,
    noAlbino: true,
    eye: '#ff2a2a',
    gore: ['#3a4048', '#8a949e', '#c02020', '#1a1c20'],
  },
  {
    id: 'f12_lineman',
    name: 'Путевой обходчик',
    many: 'путевых обходчиков',
    hp: 48,
    dmg: 20,
    speed: 2.7,
    radius: 0.36,
    windup: 0.7,
    reach: 0.8,
    rest: 1.1,
    xp: 20,
    meat: ['f12_stew', 0.3, 1],
    mats: [['f12mat', 0.4]],
    beast: true,
    brain: 'f12_lineman',
    art: { kind: 'paint', id: 'f12_lineman' },
    mass: 2,
    flinch: 0.3,
    stunT: 0.3,
    eye: '#ff6a3a',
    light: 2.2,
    gore: ['#2a2a24', '#d86a1a', '#8a2020', '#141210'],
  },
  {
    id: 'f12_dodger',
    name: 'Безбилетник',
    many: 'безбилетников',
    hp: 24,
    dmg: 6,
    speed: 5.6,
    radius: 0.28,
    windup: 0.4,
    reach: 0.3,
    rest: 1,
    xp: 34,
    meat: ['f12_snack', 0.6, 1],
    mats: [['f12mat', 0.7]],
    beast: true,
    brain: 'f12_dodger',
    art: { kind: 'paint', id: 'f12_dodger' },
    mass: 0.8,
    flinch: 1,
    coins: 2000,
    resume: 'flee',
    eye: '#ffd040',
    light: 1.4,
    gore: ['#2a2430', '#ffd040', '#5a4a6a', '#141018'],
  },
  {
    // Столб-талисман проклятой территории: держит круг, пока цел.
    id: 'f12_pillar',
    name: 'Столб территории',
    many: 'столбов территории',
    hp: 30,
    dmg: 0,
    speed: 0,
    radius: 0.34,
    windup: 0,
    reach: 0,
    rest: 1,
    xp: 8,
    meat: null,
    mats: [['f12_talisman', 0.3]],
    beast: false,
    brain: 'f12_pillar',
    art: { kind: 'paint', id: 'f12_pillar' },
    mass: 99,
    flinch: 0,
    noAlbino: true,
    eye: '#ff3aa0',
    light: 1.6,
    gore: ['#e8dcc0', '#a01830', '#2a1418', '#ff70c0'],
  },
  {
    // Вагон состава: голова (фары) и вагоны — куски одного поезда. Живут
    // только пока едут; удары их не берут.
    id: 'f12_train',
    name: 'Поезд',
    many: 'поездов',
    hp: 1e9,
    dmg: 30,
    speed: 0,
    radius: 0.9,
    windup: 0,
    reach: 0,
    rest: 0,
    xp: 0,
    meat: null,
    mats: [],
    beast: false,
    brain: 'f12_train',
    art: { kind: 'paint', id: 'f12_train' },
    mass: 999,
    noAlbino: true,
    light: 3.4,
    eye: '#fff6c8',
  },
  {
    // Фары: свет, что бежит перед составом по рельсам.
    id: 'f12_lamp',
    name: 'Фары',
    many: 'фар',
    hp: 1e9,
    dmg: 0,
    speed: 0,
    radius: 0.2,
    windup: 0,
    reach: 0,
    rest: 0,
    xp: 0,
    meat: null,
    mats: [],
    beast: false,
    brain: 'f12_train',
    art: { kind: 'paint', id: 'f12_lamp' },
    mass: 999,
    noAlbino: true,
    light: 4.6,
  },
  {
    id: 'f12boss',
    name: 'Двуликий король проклятий',
    many: 'двуликих королей',
    hp: 1100,
    dmg: 24,
    speed: 2.6,
    radius: 0.85,
    windup: 0.85,
    reach: 1,
    rest: 0.9,
    xp: 1100,
    meat: null,
    mats: [],
    beast: true,
    brain: 'f12boss',
    art: { kind: 'paint', id: 'f12boss' },
    mass: 14,
    boss: true,
    noAlbino: true,
    eye: '#ff2030',
    light: 2.6,
    gore: ['#1a0a10', '#8a1020', '#f0e6dc', '#e0402e'],
  },
];

/** Вестибюль: мухи роем, многоликие, куклы из-за спин. */
const spawnHall: SpawnSpec = {
  mobs: [
    ['f12_flies', 46],
    ['f12_manyface', 30],
    ['f12_doll', 14],
    ['f12_poster', 10],
  ],
  density: 0.7,
  pack: [1, 2],
  filler: 'f12_flies',
  // Спящая стая: многоликий в окружении мух.
  group: (i) => (i === 0 ? 'f12_manyface' : 'f12_flies'),
  horde: null,
  treasure: 'f12_dodger',
  nest: () => 'f12_flies',
};

const spawnPlat: SpawnSpec = {
  ...spawnHall,
  mobs: [
    ['f12_flies', 36],
    ['f12_lineman', 24],
    ['f12_manyface', 22],
    ['f12_doll', 18],
  ],
  density: 0.74,
  group: (i) => (i < 2 ? 'f12_lineman' : 'f12_flies'),
};

const spawnShrine: SpawnSpec = {
  ...spawnHall,
  mobs: [
    ['f12_manyface', 32],
    ['f12_doll', 28],
    ['f12_flies', 28],
    ['f12_lineman', 12],
  ],
  density: 0.78,
  pack: [1, 2],
  filler: 'f12_flies',
  group: (i) => (i === 0 ? 'f12_doll' : i === 1 ? 'f12_manyface' : 'f12_flies'),
};

export const F12: FloorDef = {
  id: 12,
  name: 'Проклятая станция',
  lead: 'Метро, где ходят поезда без машиниста. Проклятия держат свои территории.',
  mapVer: 1,
  areas: [
    {
      id: F12_HALL,
      name: 'Вестибюль',
      lead: 'Турникеты, эскалаторы вниз и служебная ветка. Слушай семафор.',
      tier: 8,
      level: 9,
      ambient: 0.5,
      rows: MAP_F12_HALL,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.82, 0.86, 0.84], mix: '#1a2a26', k: 0.1 },
        fog: '#06080a',
      },
      legend: LEGEND,
      mine: 'f12mine',
      spawn: spawnHall,
    },
    {
      id: F12_PLAT,
      name: 'Платформы и туннели',
      lead: 'Две линии, перегоны с нишами, депо и узловая. Фары — беги в нишу.',
      tier: 8,
      level: 9,
      ambient: 0.36,
      rows: MAP_F12_PLAT,
      skin: {
        floor: 'slab',
        wall: 'brick',
        tint: { mul: [0.7, 0.76, 0.78], mix: '#0a1a1e', k: 0.14 },
        fog: '#030506',
      },
      legend: LEGEND,
      spawn: spawnPlat,
    },
    {
      id: F12_SHRINE,
      name: 'Святилище под перегоном',
      lead: 'Под путями — храм проклятий. Над головой идут поезда.',
      tier: 8,
      level: 9,
      ambient: 0.4,
      rows: MAP_F12_SHRINE,
      skin: {
        floor: 'ground',
        wall: 'rock',
        tint: { mul: [0.7, 0.6, 0.72], mix: '#2a0a1e', k: 0.14 },
        fog: '#08030a',
      },
      legend: LEGEND,
      mine: 'f12mine2',
      spawn: spawnShrine,
    },
  ],
  boss: {
    id: 'f12boss',
    name: 'Двуликий король проклятий',
    lead: 'Жертвенный храм под перегоном',
    area: F12_SHRINE,
    restMs: 20 * 60_000,
    mob: 'f12boss',
    script: 'f12boss',
    parts: ['f12boss'],
    loot: (rnd) => ({
      tokens: 80 + Math.floor(rnd() * 40),
      keys: rnd() < 0.8 ? 1 : 0,
      coins: 72_000,
      mats: {
        f12_mask: 1,
        f12mat: 4 + Math.floor(rnd() * 4),
        f12_finger: 1 + Math.floor(rnd() * 2),
      },
    }),
  },
  mines: [
    {
      id: 'f12mine',
      name: 'Шахта у служебной лестницы',
      area: F12_HALL,
      windowMs: 60 * 60_000,
      ores: [22, 23],
      share: [0.24, 0.3, 0.38, 0.46, 0.55],
      pyrite: 0,
      blocks: 2.6,
    },
    {
      id: 'f12mine2',
      name: 'Шахта у святилища',
      area: F12_SHRINE,
      windowMs: 3 * 60 * 60_000,
      ores: [22, 23],
      share: [0.3, 0.38, 0.46, 0.54, 0.62],
      pyrite: 0,
      blocks: 3.2,
    },
  ],
  mobs: MOBS,
  meats: [
    { id: 'f12_snack', name: 'Пирожок из буфета', price: 70, heal: 0.3 },
    { id: 'f12_stew', name: 'Тушёнка обходчика', price: 120, heal: 0.45 },
  ],
  mats: [
    {
      id: 'f12mat',
      name: 'Проклятый жетон',
      price: 540,
      lead: 'Метрожетон, тёплый на ощупь. Сам по себе звенит в кармане.',
    },
    {
      id: 'f12_talisman',
      name: 'Обгоревший талисман',
      price: 700,
      lead: 'Бумажная печать с чужого столба. Края тлеют и не догорают.',
    },
    {
      id: 'f12_lens',
      name: 'Линза глаза',
      price: 760,
      lead: 'Мутная, как стекло вагона. Если долго смотреть — моргает.',
    },
    {
      id: 'f12_finger',
      name: 'Палец проклятия',
      price: 950,
      lead: 'Сухой, чёрный, с длинным ногтем. Их, говорят, ровно двадцать.',
    },
    {
      id: 'f12_mask',
      name: 'Двуликая маска',
      price: 72_000,
      lead: 'Трофей. Два лица на одной кости: одно улыбается, другое смотрит.',
      stack: 1,
    },
  ],
  music: { explore: 'depths', boss: 'boss' },
  cover: '/ui/areas/f12.png',
};
